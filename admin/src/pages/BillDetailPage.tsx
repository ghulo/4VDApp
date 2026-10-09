import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, Button, ButtonLink, Card, DataTable, EmptyState, Field, PageHeader, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';
import { billsApi } from '../services/api';
import { mediaSrc } from '../services/apiClient';
import type { SupplierBill, SupplierPaymentMethod } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';
import { shrinkPhoto } from '../utils/shrinkPhoto';
import { BillFields, DueBadge } from '../components/BillParts';
import { BILL_STATUS_TONE, type BillDraft, isBillValid, todayIso, toBillInput } from '../utils/bills';

const METHODS: SupplierPaymentMethod[] = ['bank', 'drawer', 'cash'];

/** One supplier bill: what's left, every payment, the paper photo, and fixing mistakes. */
export function BillDetailPage() {
  const t = useT();
  const id = Number(useParams().id);
  const bill = useQuery({ queryKey: ['bills', id], queryFn: () => billsApi.get(id) });

  if (bill.isPending) return <Loading />;
  if (bill.isError) return <ErrorNotice error={bill.error} onRetry={() => bill.refetch()} />;
  const b = bill.data;
  const open = b.status !== 'void';

  return (
    <>
      <PageHeader
        title={b.supplier.name}
        crumbs={[{ label: t.bills.title, to: '/bills' }]}
        meta={<Badge tone={BILL_STATUS_TONE[b.status]}>{t.bills.statuses[b.status]}</Badge>}
        description={[b.number ? t.bills.numbered(b.number) : t.bills.noNumber, t.bills.recordedBy(b.recordedBy ?? t.sales.unknown)].join(' · ')}
        actions={
          <ButtonLink to={`/suppliers/${b.supplier.id}`} variant="ghost">
            {t.suppliers.see}
          </ButtonLink>
        }
      />
      {b.voidNote && <p className="callout document-note">{t.bills.voided(b.voidNote)}</p>}

      <StatGrid>
        <StatTile label={t.bills.amount} value={formatMoney(b.amount)} hint={t.bills.dated(formatDate(b.issuedOn))} />
        <StatTile label={t.bills.paid} value={formatMoney(b.paid)} />
        <StatTile label={t.bills.left} value={formatMoney(b.left)} tone={b.overdue ? 'danger' : 'default'} hint={<DueBadge bill={b} />} />
      </StatGrid>

      {b.orderId && (
        <p className="field-hint">
          {t.bills.fromOrder} <Link to={`/orders/${b.orderId}`}>{t.bills.orderNo(b.orderId)}</Link>
        </p>
      )}

      {b.left > 0 && <PayCard bill={b} />}
      <PaymentsCard bill={b} />
      <PhotoCard bill={b} />
      {open && <EditCard bill={b} />}
    </>
  );
}

function useBillUpdate() {
  const queryClient = useQueryClient();
  return (updated: SupplierBill) => {
    queryClient.setQueryData(['bills', updated.id], updated);
    for (const key of ['bills', 'cash', 'activity', 'full-report', 'orders']) queryClient.invalidateQueries({ queryKey: [key] });
  };
}

function PayCard({ bill }: { bill: SupplierBill }) {
  const t = useT();
  const onSaved = useBillUpdate();
  const [amount, setAmount] = useState(String(bill.left));
  const [paidOn, setPaidOn] = useState(todayIso());
  const [method, setMethod] = useState<SupplierPaymentMethod>('bank');
  const [note, setNote] = useState('');
  const pay = useMutation({
    mutationFn: () => billsApi.pay(bill.id, { amount: Number(amount), paidOn, method, note: note.trim() || null }),
    onSuccess: (updated) => {
      onSaved(updated);
      setAmount(String(updated.left));
      setNote('');
    },
  });
  const value = Number(amount);
  const valid = value > 0 && value <= bill.left && paidOn !== '';

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    pay.mutate();
  }

  return (
    <Card title={t.bills.recordPayment} description={t.bills.recordPaymentHint}>
      <form className="settings-form" onSubmit={handleSubmit}>
        <div className="field-row">
          <Field label={t.bills.amountEuro} hint={value > bill.left ? t.bills.atMost(formatMoney(bill.left)) : undefined}>
            <input required type="number" inputMode="decimal" autoComplete="off" min={0.01} max={bill.left} step={0.01} value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label={t.bills.paidOn}>
            <input required type="date" max={todayIso()} value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
          </Field>
        </div>
        <div className="field">
          <span className="field__label" id={`method-${bill.id}`}>
            {t.bills.how}
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby={`method-${bill.id}`}>
            {METHODS.map((option) => (
              <button key={option} type="button" role="radio" aria-checked={method === option} className="segmented__option" onClick={() => setMethod(option)}>
                {t.bills.methods[option]}
              </button>
            ))}
          </div>
          {method === 'drawer' && <span className="field__hint">{t.bills.drawerHint}</span>}
        </div>
        <Field label={t.bills.note}>
          <input maxLength={500} autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {pay.isError && (
          <p className="form-error" role="alert">
            {errorMessage(pay.error)}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={!valid || pay.isPending}>
            {pay.isPending ? t.bills.saving : value === bill.left ? t.bills.payInFull(formatMoney(value)) : t.bills.pay(formatMoney(value || 0))}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PaymentsCard({ bill }: { bill: SupplierBill }) {
  const t = useT();
  const onSaved = useBillUpdate();
  const [confirming, setConfirming] = useState<number | null>(null);
  const remove = useMutation({
    mutationFn: (paymentId: number) => billsApi.voidPayment(bill.id, paymentId),
    onSuccess: (updated) => {
      onSaved(updated);
      setConfirming(null);
    },
  });

  return (
    <Card title={t.bills.payments} flush>
      <DataTable
        empty={<EmptyState title={t.bills.noPayments} />}
        caption={t.bills.payments}
        rows={bill.payments}
        rowKey={(payment) => payment.id}
        rowClassName={(payment) => (payment.voided ? 'is-undone' : undefined)}
        columns={[
          { header: t.bills.paidOn, title: true, cell: (payment) => formatDate(payment.paidOn) },
          { header: t.bills.how, cell: (payment) => t.bills.methods[payment.method] },
          { header: t.bills.note, cell: (payment) => payment.note ?? '–' },
          { header: t.bills.by, cell: (payment) => payment.recordedBy ?? '–' },
          { header: t.bills.amount, align: 'end', cell: (payment) => (payment.voided ? <s>{formatMoney(payment.amount)}</s> : formatMoney(payment.amount)) },
          {
            header: <span className="visually-hidden">{t.bills.actions}</span>,
            cell: (payment) =>
              payment.voided ? (
                <Badge>{t.bills.removed}</Badge>
              ) : confirming === payment.id ? (
                <span className="inline-confirm">
                  <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(payment.id)}>
                    {t.bills.confirmRemove}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    {t.common.cancel}
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirming(payment.id)}>
                  {t.bills.remove}
                </Button>
              ),
          },
        ]}
      />
      {remove.isError && (
        <p className="form-error" role="alert">
          {errorMessage(remove.error)}
        </p>
      )}
    </Card>
  );
}

function PhotoCard({ bill }: { bill: SupplierBill }) {
  const t = useT();
  const onSaved = useBillUpdate();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({ mutationFn: async (file: File) => billsApi.setPhoto(bill.id, await shrinkPhoto(file)), onSuccess: onSaved });
  const remove = useMutation({ mutationFn: () => billsApi.removePhoto(bill.id), onSuccess: onSaved });
  const src = mediaSrc(bill.photoUrl);

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) upload.mutate(file);
  }

  return (
    <Card
      title={t.bills.photo}
      description={t.bills.photoHint}
      actions={
        <>
          <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
          <Button size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
            {upload.isPending ? t.bills.uploading : src ? t.bills.replacePhoto : t.bills.addPhoto}
          </Button>
          {src && (
            <Button size="sm" variant="danger-text" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t.bills.remove}
            </Button>
          )}
        </>
      }
    >
      {src ? (
        <a href={src} target="_blank" rel="noreferrer" className="bill-photo">
          <img src={src} alt={t.bills.photoAlt(bill.supplier.name)} />
        </a>
      ) : (
        <p className="field-hint">{t.bills.noPhoto}</p>
      )}
      {(upload.isError || remove.isError) && (
        <p className="form-error" role="alert">
          {errorMessage(upload.error ?? remove.error)}
        </p>
      )}
    </Card>
  );
}

function EditCard({ bill }: { bill: SupplierBill }) {
  const t = useT();
  const onSaved = useBillUpdate();
  const initial: BillDraft = { number: bill.number ?? '', issuedOn: bill.issuedOn, dueOn: bill.dueOn ?? '', amount: String(bill.amount), note: bill.note ?? '' };
  const [draft, setDraft] = useState(initial);
  const [voidNote, setVoidNote] = useState('');
  const save = useMutation({ mutationFn: () => billsApi.update(bill.id, toBillInput(draft)), onSuccess: onSaved });
  const voidBill = useMutation({ mutationFn: () => billsApi.void(bill.id, voidNote.trim()), onSuccess: onSaved });
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);
  const hasPayments = bill.payments.some((payment) => !payment.voided);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Card title={t.bills.details} description={t.bills.detailsHint}>
      <form className="settings-form" onSubmit={handleSubmit}>
        <BillFields draft={draft} onChange={setDraft} />
        {save.isError && (
          <p className="form-error" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" variant={changed ? 'primary' : 'secondary'} disabled={!changed || !isBillValid(draft) || save.isPending}>
            {save.isPending ? t.bills.saving : t.common.save}
          </Button>
        </div>
      </form>
      <div className="danger-zone">
        <p className="setting-row__title">{t.bills.voidTitle}</p>
        <p className="field-hint">{hasPayments ? t.bills.voidNeedsNoPayments : t.bills.voidHint}</p>
        <div className="inline-form">
          <label className="visually-hidden" htmlFor={`void-${bill.id}`}>
            {t.bills.voidReason}
          </label>
          <input
            id={`void-${bill.id}`}
            autoComplete="off"
            placeholder={t.bills.voidReason}
            maxLength={500}
            value={voidNote}
            disabled={hasPayments}
            onChange={(event) => setVoidNote(event.target.value)}
          />
          <Button variant="danger" disabled={hasPayments || !voidNote.trim() || voidBill.isPending} onClick={() => voidBill.mutate()}>
            {t.bills.void}
          </Button>
        </div>
        {voidBill.isError && (
          <p className="form-error" role="alert">
            {errorMessage(voidBill.error)}
          </p>
        )}
      </div>
    </Card>
  );
}
