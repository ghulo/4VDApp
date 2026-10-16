import { Plus, Receipt, Scan } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, Button, ButtonLink, DataTable, EmptyState, Field, PageHeader, Sheet, useNewSheet } from '../components/ui';
import { useT } from '../i18n/useT';
import { billsApi, suppliersApi } from '../services/api';
import type { SupplierBill } from '../services/types';
import { BillFields, DueBadge } from '../components/BillParts';
import { ScanBillForm, WaitingScans } from '../components/BillScanParts';
import { BILL_STATUS_TONE, emptyBill, isBillValid, toBillInput } from '../utils/bills';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';

/** Matches the server's "due this week" (BILL_DUE_SOON_DAYS). */
const DUE_SOON_DAYS = 7;
const FILTERS = ['open', 'overdue', 'soon', 'paid', 'all'] as const;
type StatusFilter = (typeof FILTERS)[number];

const isOpen = (bill: SupplierBill) => bill.status !== 'void' && bill.left > 0;
const NARROW: Partial<Record<StatusFilter, (bill: SupplierBill) => boolean>> = {
  overdue: (bill) => bill.overdue,
  soon: (bill) => !bill.overdue && bill.daysLeft !== null && bill.daysLeft <= DUE_SOON_DAYS,
};

/** Every bill from every supplier, most urgent first; narrowed to one supplier with ?supplier=. */
export function BillsPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status: StatusFilter = (FILTERS as readonly string[]).includes(params.get('status') ?? '') ? (params.get('status') as StatusFilter) : 'open';
  const supplierId = params.get('supplier') ?? '';
  const [adding, setAdding] = useNewSheet();
  const [scanning, setScanning] = useNewSheet('scan');
  const summary = useQuery({ queryKey: ['bills', 'summary'], queryFn: billsApi.summary });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  // Overdue and due-this-week are the unpaid list narrowed down here, so they share its request.
  const asked = status === 'all' ? undefined : status === 'paid' ? 'paid' : 'open';
  const bills = useQuery({
    queryKey: ['bills', { status: asked, supplierId }],
    queryFn: () => billsApi.list({ status: asked, supplierId: supplierId ? Number(supplierId) : undefined }),
  });
  const narrow = NARROW[status];
  const rows = (bills.data ?? []).filter((bill) => !narrow || narrow(bill));
  const leftInList = rows.filter(isOpen).reduce((sum, bill) => sum + bill.left, 0);
  const counted = rows.filter((bill) => bill.status !== 'void');
  const amountInList = counted.reduce((sum, bill) => sum + bill.amount, 0);
  const counts: Partial<Record<StatusFilter, number>> = supplierId ? {} : { overdue: summary.data?.overdue.count, soon: summary.data?.dueSoon.count };
  const supplierName = suppliers.data?.find((row) => String(row.id) === supplierId)?.name;

  const setFilter = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        wide
        title={t.nav.items.suppliers}
        description={t.bills.description}
        actions={
          <>
            <Button icon={Plus} onClick={() => setAdding(true)}>
              {t.bills.add}
            </Button>
            <Button variant="primary" icon={Scan} onClick={() => setScanning(true)}>
              {t.scans.scan}
            </Button>
          </>
        }
      />

      <Sheet open={adding} onClose={() => setAdding(false)} title={t.bills.newBill} description={t.bills.addHint}>
        <NewBillForm initialSupplier={supplierId} onDone={() => setAdding(false)} />
      </Sheet>

      <Sheet open={scanning} onClose={() => setScanning(false)} title={t.scans.scanTitle} description={t.scans.scanHint}>
        <ScanBillForm onDone={() => setScanning(false)} />
      </Sheet>

      <WaitingScans />

      {bills.isError && <ErrorNotice error={bills.error} onRetry={() => bills.refetch()} />}
      <DataTable<SupplierBill>
        caption={t.bills.title}
        rows={rows}
        rowKey={(bill) => bill.id}
        rowClassName={(bill) => (bill.status === 'void' ? 'is-undone' : undefined)}
        onRowClick={(bill) => navigate(`/bills/${bill.id}`)}
        toolbar={
          <div className="toolbar">
            <div className="segmented segmented--chips" role="radiogroup" aria-label={t.bills.show}>
              {FILTERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={status === option}
                  className="segmented__option"
                  onClick={() => setFilter({ status: option === 'open' ? '' : option })}
                >
                  {t.bills.filters[option]}
                  {(counts[option] ?? 0) > 0 && <span className="segmented__count">{counts[option]}</span>}
                </button>
              ))}
            </div>
            <select aria-label={t.bills.supplier} value={supplierId} onChange={(event) => setFilter({ supplier: event.target.value })}>
              <option value="">{t.bills.anySupplier}</option>
              {suppliers.data?.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            {supplierName && <Link to={`/suppliers/${supplierId}`}>{t.suppliers.see}</Link>}
          </div>
        }
        columns={[
          {
            header: t.bills.bill,
            title: true,
            cell: (bill) => (
              <Link to={`/bills/${bill.id}`} className="table__primary-link">
                {bill.supplier.name}
                <span className="table__secondary">{bill.number ? t.bills.numbered(bill.number) : t.bills.noNumber}</span>
              </Link>
            ),
          },
          { header: t.bills.issuedOn, cell: (bill) => formatDate(bill.issuedOn) },
          { header: t.bills.due, cell: (bill) => (isOpen(bill) ? <DueBadge bill={bill} /> : '–') },
          { header: t.bills.amount, align: 'end', cell: (bill) => formatMoney(bill.amount) },
          { header: t.bills.left, align: 'end', cell: (bill) => (isOpen(bill) ? <strong>{formatMoney(bill.left)}</strong> : '–') },
          { header: t.bills.status, cell: (bill) => <Badge tone={BILL_STATUS_TONE[bill.status]}>{t.bills.statuses[bill.status]}</Badge> },
          {
            header: <span className="visually-hidden">{t.bills.actions}</span>,
            align: 'end',
            cell: (bill) =>
              isOpen(bill) ? (
                <ButtonLink to={`/bills/${bill.id}#pay`} size="sm" aria-label={t.bills.payLabel(bill.supplier.name)}>
                  {t.bills.payShort}
                </ButtonLink>
              ) : null,
          },
        ]}
        totals={[t.bills.totalOf(counted.length), '', '', formatMoney(amountInList), leftInList > 0 ? formatMoney(leftInList) : '–', '', '']}
        empty={
          bills.isPending ? (
            <Loading />
          ) : (
            <EmptyState icon={Receipt} title={status === 'open' && !supplierId ? t.bills.allPaid : t.bills.noneMatch}>
              {status === 'open' && !supplierId ? t.bills.allPaidHint : undefined}
            </EmptyState>
          )
        }
      />
    </>
  );
}

function NewBillForm({ initialSupplier, onDone }: { initialSupplier: string; onDone: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const [supplierId, setSupplierId] = useState(initialSupplier);
  const [draft, setDraft] = useState(emptyBill());
  const create = useMutation({
    mutationFn: () => billsApi.create({ supplierId: Number(supplierId), ...toBillInput(draft) }),
    onSuccess: (bill) => {
      for (const key of ['bills', 'attention']) queryClient.invalidateQueries({ queryKey: [key] });
      onDone();
      navigate(`/bills/${bill.id}`);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  if (suppliers.data?.length === 0) {
    return <EmptyState title={t.bills.noSuppliers} action={<ButtonLink to="/suppliers?new=1">{t.bills.addSupplier}</ButtonLink>} />;
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={t.bills.supplier}>
        <select required value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
          <option value="">{t.bills.chooseSupplier}</option>
          {suppliers.data?.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </Field>
      <BillFields draft={draft} onChange={setDraft} />
      {create.isError && (
        <p className="form-error" role="alert">
          {errorMessage(create.error)}
        </p>
      )}
      <div className="form-actions">
        <Button variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={!supplierId || !isBillValid(draft) || create.isPending} loading={create.isPending}>
          {t.bills.save}
        </Button>
      </div>
    </form>
  );
}
