import { Plus, Receipt, Scan } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, Button, ButtonLink, DataTable, EmptyState, PageHeader, Sheet, useNewSheet } from '../components/ui';
import { useT } from '../i18n/useT';
import { canOversee } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { billsApi, suppliersApi } from '../services/api';
import type { SupplierBill } from '../services/types';
import { DueBadge } from '../components/BillParts';
import { SourceFilter, sourceFrom, TrefinTag } from '../components/TrefinParts';
import { ScanBillForm, WaitingScans } from '../components/BillScanParts';
import { BILL_STATUS_TONE } from '../utils/bills';
import { formatDate, formatMoney } from '../utils/format';

/** Matches the server's "due this week" (BILL_DUE_SOON_DAYS). */
const DUE_SOON_DAYS = 7;
const FILTERS = ['open', 'overdue', 'soon', 'paid', 'all'] as const;
type StatusFilter = (typeof FILTERS)[number];

/** A bill with money still to pay; a return or credit is never paid from here. */
const isOpen = (bill: SupplierBill) => bill.kind === 'bill' && bill.status !== 'void' && bill.left > 0;
/** A return or credit counts against the bills it sits beside. */
const signed = (bill: SupplierBill) => (bill.kind === 'credit' ? -bill.amount : bill.amount);
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
  const source = sourceFrom(params);
  const [scanning, setScanning] = useNewSheet('scan');
  // The accountant reads the bills; adding and paying them stays with the people who run the shop.
  const writes = canOversee(useCurrentUser().role);
  const summary = useQuery({ queryKey: ['bills', 'summary'], queryFn: billsApi.summary });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  // Overdue and due-this-week are the unpaid list narrowed down here, so they share its request.
  const asked = status === 'all' ? undefined : status === 'paid' ? 'paid' : 'open';
  const bills = useQuery({
    queryKey: ['bills', { status: asked, supplierId, source }],
    queryFn: () => billsApi.list({ status: asked, supplierId: supplierId ? Number(supplierId) : undefined, source }),
  });
  const narrow = NARROW[status];
  const rows = (bills.data ?? []).filter((bill) => !narrow || narrow(bill));
  const leftInList = rows.filter(isOpen).reduce((sum, bill) => sum + bill.left, 0);
  const counted = rows.filter((bill) => bill.status !== 'void');
  const amountInList = counted.reduce((sum, bill) => sum + signed(bill), 0);
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

  // The old "add a bill" link (?new=1) opens the bill form.
  const newBill = supplierId ? `/bills/new?supplier=${supplierId}` : '/bills/new';
  if (params.get('new')) return <Navigate to={newBill} replace />;

  return (
    <>
      <PageHeader
        title={t.nav.items.suppliers}
        description={t.bills.description}
        actions={
          writes && (
          <>
            <ButtonLink to={newBill} icon={Plus}>
              {t.bills.add}
            </ButtonLink>
            <Button variant="primary" icon={Scan} onClick={() => setScanning(true)}>
              {t.scans.scan}
            </Button>
          </>
          )
        }
      />

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
            {/* TREFIN's bills are never open or paid here, so asking for them shows every status. */}
            <SourceFilter value={source} onChange={(next) => setFilter({ source: next ?? '', ...(next === 'trefin' && { status: 'all' }) })} />
            {supplierName && <Link to={`/suppliers/${supplierId}`}>{t.suppliers.see}</Link>}
          </div>
        }
        columns={[
          {
            header: t.bills.bill,
            title: true,
            cell: (bill) => (
              <Link to={`/bills/${bill.id}`} className="table__primary-link">
                {bill.supplier?.name ?? t.bills.noSupplier}
                {bill.fromTrefin && bill.status !== 'history' && (
                  <>
                    {' '}
                    <TrefinTag />
                  </>
                )}
                <span className="table__secondary">
                  {[bill.kind === 'credit' ? (bill.returnsStock ? t.bills.returnStamp : t.bills.creditStamp) : null, bill.number ? t.bills.numbered(bill.number) : t.bills.noNumber]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </Link>
            ),
          },
          { header: t.bills.issuedOn, cell: (bill) => formatDate(bill.issuedOn) },
          { header: t.bills.due, cell: (bill) => (isOpen(bill) ? <DueBadge bill={bill} /> : '–') },
          { header: t.bills.amount, align: 'end', cell: (bill) => formatMoney(signed(bill)) },
          { header: t.bills.left, align: 'end', cell: (bill) => (isOpen(bill) ? <strong>{formatMoney(bill.left)}</strong> : '–') },
          { header: t.bills.status, cell: (bill) => <Badge tone={BILL_STATUS_TONE[bill.status]}>{t.bills.statuses[bill.status]}</Badge> },
          {
            header: <span className="visually-hidden">{t.bills.actions}</span>,
            align: 'end',
            cell: (bill) =>
              writes && isOpen(bill) ? (
                <ButtonLink to={`/bills/${bill.id}#pay`} size="sm" aria-label={t.bills.payLabel(bill.supplier?.name ?? t.bills.noSupplier)}>
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

