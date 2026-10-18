import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, Button, ButtonLink, Card, DataTable, DateField, EmptyState, Field, PageHeader, Section, Sheet, StatGrid, StatTile, useNewSheet } from '../components/ui';
import { useT } from '../i18n/useT';
import { billsApi } from '../services/api';
import { mediaSrc } from '../services/apiClient';
import type { BillLine, SupplierBill } from '../services/types';
import { PlaceSelect, usePlaces, usualPlace } from '../components/MoneyParts';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';
import { shrinkPhoto } from '../utils/shrinkPhoto';
import { TrefinTag } from '../components/TrefinParts';
import { BillFields, DueBadge } from '../components/BillParts';
import { BILL_STATUS_TONE, type BillDraft, isBillValid, todayIso, toBillInput } from '../utils/bills';
import { EntriesPanel } from '../components/BooksParts';
import { HistoryCard } from '../components/HistoryCard';
import { QuestionsCard } from '../components/QuestionsCard';
import { formatMonth } from '../utils/vat';
import { useCurrentUser } from '../auth/useAuth';
import { canOversee } from '../auth/roles';
import { CreditForm } from '../components/CreditForm';
import type { Catalogue } from '../i18n/en';


/** What a cost or equipment line is, in words. */
const lineWhat = (t: Catalogue, line: BillLine) => {
  if (line.kind === 'product') return line.productName ?? t.bills.kinds.product;
  const category = line.category ?? 'other';
  const named =
    line.kind === 'cost'
      ? (t.expenses.categories as Record<string, string>)[category]
      : (t.bills.equipmentCategories as Record<string, string>)[category];
  return named ?? category;
};

/** A bill with money still to pay. */
const owes = (bill: SupplierBill) => bill.kind === 'bill' && bill.status !== 'void' && bill.left > 0;

/** One supplier bill (or a return or credit): what's on it, what's left, every payment, the paper photo, and fixing mistakes. */
export function BillDetailPage() {
  const t = useT();
  const id = Number(useParams().id);
  const bill = useQuery({ queryKey: ['bills', id], queryFn: () => billsApi.get(id) });
  const [crediting, setCrediting] = useNewSheet('credit');
  // The accountant reads bills and asks about them; changing them stays with the people who run the shop.
  const writes = canOversee(useCurrentUser().role);

  if (bill.isPending) return <Loading />;
  if (bill.isError) return <ErrorNotice error={bill.error} onRetry={() => bill.refetch()} />;
  const b = bill.data;
  // TREFIN's history is only to look at.
  const canChange = writes && !b.fromTrefin;
  const open = b.status !== 'void';
  const isCredit = b.kind === 'credit';
  const who = b.supplier?.name ?? null;
  const title = isCredit ? (b.returnsStock ? t.bills.returnTitle(who ?? '') : t.bills.creditTitle(who ?? '')) : (who ?? t.bills.expenseTitle);
  const canCredit = canChange && !isCredit && open && b.supplier !== null && b.lines.length > 0;

  return (
    <>
      <PageHeader
        title={title}
        crumbs={[{ label: t.nav.tabs.bills, to: '/bills' }]}
        meta={
          <>
            {isCredit && open ? (
              <Badge tone="info">{b.returnsStock ? t.bills.returnStamp : t.bills.creditStamp}</Badge>
            ) : (
              <Badge tone={BILL_STATUS_TONE[b.status]}>{t.bills.statuses[b.status]}</Badge>
            )}
            {b.fromTrefin && (isCredit || b.status !== 'history') && <TrefinTag />}
            {b.paidNow && <Badge tone="neutral">{t.bills.paidNowStamp}</Badge>}
            {b.repeatId !== null && <Badge tone="neutral">{t.bills.repeatStamp}</Badge>}
          </>
        }
        description={[b.number ? t.bills.numbered(b.number) : t.bills.noNumber, t.bills.recordedBy(b.recordedBy ?? t.sales.unknown)].join(' · ')}
        actions={
          <>
            {b.supplier && (
              <ButtonLink to={`/suppliers/${b.supplier.id}`} variant="ghost">
                {t.suppliers.see}
              </ButtonLink>
            )}
            {canCredit && <Button onClick={() => setCrediting(true)}>{t.bills.returnOrCredit}</Button>}
          </>
        }
      />
      {b.voidNote && <p className="callout document-note">{t.bills.voided(b.voidNote)}</p>}
      {b.vatMonth && <p className="callout document-note">{t.bills.lateVat(formatMonth(b.vatMonth))}</p>}

      {b.fromTrefin ? (
        <>
          <div className="callout document-note">
            <p>{t.fromTrefin.billNote}</p>
            {b.note && <p className="field-hint">{b.note}</p>}
          </div>
          <StatGrid>
            <StatTile label={isCredit ? t.bills.givesBack : t.bills.amount} value={formatMoney(b.amount)} hint={t.bills.dated(formatDate(b.issuedOn))} />
            <StatTile label={t.billForm.vat} value={b.vatAmount === null ? '–' : formatMoney(b.vatAmount)} />
          </StatGrid>
        </>
      ) : isCredit ? (
        <StatGrid>
          <StatTile label={t.bills.givesBack} value={formatMoney(b.amount)} hint={t.bills.dated(formatDate(b.issuedOn))} />
          <StatTile label={t.bills.usedOnBill} value={formatMoney(b.paid)} />
          <StatTile label={t.bills.owesYou} value={formatMoney(b.left)} words={b.left === 0 && t.bills.nothingOwed} />
        </StatGrid>
      ) : (
        <StatGrid>
          <StatTile label={t.bills.amount} value={formatMoney(b.amount)} hint={t.bills.dated(formatDate(b.issuedOn))} />
          <StatTile label={t.bills.paid} value={formatMoney(b.paid)} />
          <StatTile label={t.bills.left} value={formatMoney(b.left)} tone={b.overdue ? 'danger' : 'default'} hint={<DueBadge bill={b} />} />
        </StatGrid>
      )}

      {isCredit && open && b.left > 0 && who && <p className="callout document-note">{t.bills.owesYouHint(who, formatMoney(b.left))}</p>}

      {(b.orderId || b.scanId || b.creditFor) && (
        <p className="field-hint">
          {b.creditFor && (
            <>
              {t.bills.against} <Link to={`/bills/${b.creditFor.id}`}>{t.bills.againstBill(b.creditFor.number)}</Link>
            </>
          )}
          {b.orderId && (
            <>
              {t.bills.fromOrder} <Link to={`/orders/${b.orderId}`}>{t.bills.orderNo(b.orderId)}</Link>
            </>
          )}
          {b.orderId && b.scanId && ' · '}
          {b.scanId && <Link to={`/bills/scans/${b.scanId}`}>{t.scans.fromScan}</Link>}
        </p>
      )}

      <div className={canChange && owes(b) ? 'product-layout' : undefined}>
        <div className="product-layout__main">
          {b.lines.length > 0 && <LinesSection bill={b} />}
          {b.credits.length > 0 && <CreditsSection bill={b} />}
          {!b.fromTrefin && <PaymentsCard bill={b} writes={canChange} />}
          <PhotoCard bill={b} writes={canChange} />
          {canChange && open && <EditCard bill={b} />}
          <QuestionsCard kind="bill" id={b.id} />
          <EntriesPanel source="bill" id={b.id} />
          <HistoryCard entityType="bill" entityId={b.id} />
        </div>
        {canChange && owes(b) && (
          <div className="product-layout__side buy-side buy-side--first">
            {/* A new amount left (after a return) starts the form again. */}
            <PayCard key={b.left} bill={b} />
          </div>
        )}
      </div>

      {canCredit && (
        <Sheet open={crediting} onClose={() => setCrediting(false)} title={t.bills.returnOrCredit} description={t.creditForm.description}>
          <CreditForm bill={b} onDone={() => setCrediting(false)} />
        </Sheet>
      )}
    </>
  );
}

/** The bill's lines, and what it did beyond them: customs, tax held back. */
function LinesSection({ bill }: { bill: SupplierBill }) {
  const t = useT();
  const vat = bill.lines.reduce((sum, line) => sum + line.vat, 0);
  const gross = bill.lines.reduce((sum, line) => sum + line.gross, 0);
  const selfVat = bill.lines.reduce((sum, line) => sum + line.selfVat, 0);
  const round = (amount: number) => Math.round(amount * 100) / 100;
  return (
    <Section title={t.bills.lines}>
      <DataTable
        caption={t.bills.linesCaption}
        rows={bill.lines}
        rowKey={(line) => line.id}
        columns={[
          {
            header: t.bills.what,
            title: true,
            cell: (line) => (
              <>
                {line.kind === 'product' && line.productId !== null ? <Link to={`/products/${line.productId}`}>{lineWhat(t, line)}</Link> : lineWhat(t, line)}
                <span className="table__secondary">
                  {[
                    t.bills.kinds[line.kind],
                    line.description,
                    line.spread ? t.bills.spreadNote : null,
                    line.fromDelivery ? t.bills.fromDeliveryNote : null,
                    line.selfVat > 0 ? t.bills.selfVatNote(formatMoney(line.selfVat)) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </>
            ),
          },
          { header: t.bills.quantity, align: 'end', cell: (line) => line.quantity ?? '–' },
          { header: t.bills.unitPrice, align: 'end', cell: (line) => (line.unitPrice === null ? '–' : formatMoney(line.unitPrice)) },
          { header: t.bills.vatRate, align: 'end', cell: (line) => (line.vat > 0 ? formatMoney(line.vat) : '–') },
          { header: t.bills.lineTotal, align: 'end', cell: (line) => formatMoney(line.gross) },
        ]}
        totals={[t.common.total, '', '', vat > 0 ? formatMoney(round(vat)) : '–', formatMoney(round(gross))]}
      />
      {(bill.customs || bill.withholding || selfVat > 0) && (
        <div className="bill-extras">
          {bill.customs && (
            <p className="field-hint">
              {t.bills.customsLine(formatMoney(bill.customs.vat), formatMoney(bill.customs.duty), t.billForm.customsMethods[bill.customs.method].toLowerCase())}
            </p>
          )}
          {bill.withholding && (
            <p className="field-hint">{t.bills.withheldLine(t.bills.withholdingTypes[bill.withholding.type], bill.withholding.rate, formatMoney(bill.withholding.amount))}</p>
          )}
          {bill.vatToClaim > 0 && (
            <p className="field-hint">
              {t.bills.vatToClaim}: {formatMoney(bill.vatToClaim)}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

/** Returns and credits made against this bill. */
function CreditsSection({ bill }: { bill: SupplierBill }) {
  const t = useT();
  return (
    <Section title={t.bills.credits}>
      <DataTable
        caption={t.bills.creditsCaption}
        rows={bill.credits}
        rowKey={(credit) => credit.id}
        rowClassName={(credit) => (credit.voided ? 'is-undone' : undefined)}
        columns={[
          {
            header: t.bills.bill,
            title: true,
            cell: (credit) => (
              <Link to={`/bills/${credit.id}`} className="table__primary-link">
                {credit.returnsStock ? t.bills.returnStamp : t.bills.creditStamp}
                <span className="table__secondary">
                  {[credit.number ? t.bills.numbered(credit.number) : t.bills.noNumber, credit.voided ? t.bills.statuses.void : null].filter(Boolean).join(' · ')}
                </span>
              </Link>
            ),
          },
          { header: t.bills.issuedOn, cell: (credit) => formatDate(credit.issuedOn) },
          { header: t.bills.amount, align: 'end', cell: (credit) => (credit.voided ? <s>{formatMoney(credit.amount)}</s> : formatMoney(credit.amount)) },
        ]}
      />
    </Section>
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
  const places = usePlaces();
  const [chosenPlace, setPlace] = useState<number | null>(null);
  const placeId = chosenPlace ?? usualPlace(places.data, 'bank');
  const fromShopTill = places.data?.find((place) => place.id === placeId)?.kind === 'till' && places.data.find((place) => place.id === placeId)?.carwashId === null;
  const [note, setNote] = useState('');
  const pay = useMutation({
    mutationFn: () => billsApi.pay(bill.id, { amount: Number(amount), paidOn, ...(placeId === null ? { method: 'bank' as const } : { placeId }), note: note.trim() || null }),
    onSuccess: (updated) => {
      onSaved(updated);
      setAmount(String(updated.left));
      setNote('');
    },
  });
  // Opened from a list's Pay button: go straight to the amount.
  useEffect(() => {
    if (window.location.hash !== '#pay') return;
    const card = document.getElementById('pay');
    card?.scrollIntoView({ block: 'start' });
    card?.querySelector('input')?.focus({ preventScroll: true });
  }, []);
  const value = Number(amount);
  const valid = value > 0 && value <= bill.left && paidOn !== '';

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    pay.mutate();
  }

  return (
    <Card title={t.bills.recordPayment} description={t.bills.recordPaymentHint} id="pay">
      <form className="settings-form" onSubmit={handleSubmit}>
        <div className="field-row">
          <Field label={t.bills.amountEuro} hint={value > bill.left ? t.bills.atMost(formatMoney(bill.left)) : undefined}>
            <input required type="number" inputMode="decimal" autoComplete="off" min={0.01} max={bill.left} step={0.01} value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label={t.bills.paidOn}>
            <DateField required max={todayIso()} value={paidOn} onChange={(value) => setPaidOn(value)} />
          </Field>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`place-${bill.id}`}>
            {t.money.payBills.from}
          </label>
          <PlaceSelect id={`place-${bill.id}`} places={places.data ?? []} value={placeId} onChange={setPlace} required />
          {fromShopTill && <span className="field__hint">{t.bills.drawerHint}</span>}
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
          <Button type="submit" variant="primary" disabled={!valid || pay.isPending} loading={pay.isPending}>
            {value === bill.left ? t.bills.payInFull(formatMoney(value)) : t.bills.pay(formatMoney(value || 0))}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PaymentsCard({ bill, writes }: { bill: SupplierBill; writes: boolean }) {
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
          {
            header: t.bills.how,
            cell: (payment) =>
              payment.method === 'credit' && payment.credit ? (
                <Link to={`/bills/${bill.kind === 'credit' ? payment.billId : payment.credit.id}`}>{t.bills.methods.credit}</Link>
              ) : (
                t.bills.methods[payment.method]
              ),
          },
          { header: t.bills.note, cell: (payment) => payment.note ?? '–' },
          { header: t.bills.by, cell: (payment) => payment.recordedBy ?? '–' },
          { header: t.bills.amount, align: 'end', cell: (payment) => (payment.voided ? <s>{formatMoney(payment.amount)}</s> : formatMoney(payment.amount)) },
          {
            header: <span className="visually-hidden">{t.bills.actions}</span>,
            cell: (payment) =>
              payment.voided ? (
                <Badge>{t.bills.removed}</Badge>
              ) : !writes || payment.method === 'credit' || bill.paidNow ? null : confirming === payment.id ? (
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

function PhotoCard({ bill, writes }: { bill: SupplierBill; writes: boolean }) {
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
        writes && (
        <>
          <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
          <Button size="sm" disabled={upload.isPending} onClick={() => input.current?.click()} loading={upload.isPending}>
            {src ? t.bills.replacePhoto : t.bills.addPhoto}
          </Button>
          {src && (
            <Button size="sm" variant="danger-text" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t.bills.remove}
            </Button>
          )}
        </>
        )
      }
    >
      {src ? (
        <a href={src} target="_blank" rel="noreferrer" className="bill-photo">
          <img src={src} alt={t.bills.photoAlt(bill.supplier?.name ?? t.bills.noSupplier)} />
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
  const initial: BillDraft = { number: bill.number ?? '', issuedOn: bill.issuedOn, dueOn: bill.dueOn ?? '', amount: String(bill.amount), vat: bill.vatAmount === null ? '' : String(bill.vatAmount), note: bill.note ?? '' };
  const [draft, setDraft] = useState(initial);
  const [voidNote, setVoidNote] = useState('');
  const save = useMutation({ mutationFn: () => billsApi.update(bill.id, toBillInput(draft)), onSuccess: onSaved });
  const voidBill = useMutation({ mutationFn: () => billsApi.void(bill.id, voidNote.trim()), onSuccess: onSaved });
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);
  // A bill paid on the spot takes its payment back with it; a return or credit's rows are its own.
  const hasPayments = !bill.paidNow && bill.kind === 'bill' && bill.payments.some((payment) => !payment.voided && payment.method !== 'credit');
  const hasCredits = bill.credits.some((credit) => !credit.voided);
  const blocked = hasPayments || hasCredits;
  const lockAmount = bill.lines.length > 0 && bill.lines.every((line) => !line.fromDelivery);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Card title={t.bills.details} description={t.bills.detailsHint}>
      <form className="settings-form" onSubmit={handleSubmit}>
        <BillFields draft={draft} onChange={setDraft} lockAmount={lockAmount} hideDue={bill.kind === 'credit' || bill.paidNow} />
        {save.isError && (
          <p className="form-error" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" variant={changed ? 'primary' : 'secondary'} disabled={!changed || !isBillValid(draft) || save.isPending} loading={save.isPending}>
            {t.common.save}
          </Button>
        </div>
      </form>
      <div className="danger-zone">
        <p className="setting-row__title">{t.bills.voidTitle}</p>
        <p className="field-hint">{hasCredits ? t.bills.voidNeedsNoCredits : hasPayments ? t.bills.voidNeedsNoPayments : bill.paidNow ? t.bills.voidPaidNow : t.bills.voidHint}</p>
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
            disabled={blocked}
            onChange={(event) => setVoidNote(event.target.value)}
          />
          <Button variant="danger" disabled={blocked || !voidNote.trim() || voidBill.isPending} onClick={() => voidBill.mutate()}>
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
