import { Plus, Receipt } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, Button, Card, DataTable, EmptyState, Field, PageHeader, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';
import { billsApi, suppliersApi } from '../services/api';
import type { SupplierBill } from '../services/types';
import { BillFields, DueBadge } from '../components/BillParts';
import { BILL_STATUS_TONE, emptyBill, isBillValid, toBillInput } from '../utils/bills';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';

type StatusFilter = 'open' | 'paid' | 'void' | 'all';

/** What the shop owes its suppliers: every bill, paid or not, and who is waiting longest. */
export function BillsPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? 'open') as StatusFilter;
  const supplierId = params.get('supplier') ?? '';
  const [adding, setAdding] = useState(false);
  const summary = useQuery({ queryKey: ['bills', 'summary'], queryFn: billsApi.summary });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const bills = useQuery({
    queryKey: ['bills', { status, supplierId }],
    queryFn: () => billsApi.list({ status: status === 'all' ? undefined : status, supplierId: supplierId ? Number(supplierId) : undefined }),
  });

  const setFilter = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };

  return (
    <>
      <PageHeader
        title={t.bills.title}
        description={t.bills.description}
        actions={
          <Button variant="primary" icon={Plus} aria-expanded={adding} onClick={() => setAdding((open) => !open)}>
            {t.bills.add}
          </Button>
        }
      />

      {adding && (
        <Card title={t.bills.newBill}>
          <NewBillForm onDone={() => setAdding(false)} />
        </Card>
      )}

      {summary.data && (
        <StatGrid>
          <StatTile label={t.bills.owed} value={formatMoney(summary.data.owed)} hint={t.bills.suppliersCount(summary.data.bySupplier.length)} />
          <StatTile
            label={t.bills.overdue}
            value={formatMoney(summary.data.overdue.amount)}
            hint={t.bills.billsCount(summary.data.overdue.count)}
            tone={summary.data.overdue.count > 0 ? 'danger' : 'default'}
          />
          <StatTile label={t.bills.dueSoon} value={formatMoney(summary.data.dueSoon.amount)} hint={t.bills.billsCount(summary.data.dueSoon.count)} />
        </StatGrid>
      )}

      {summary.data && summary.data.bySupplier.length > 0 && (
        <Card title={t.bills.bySupplier} flush>
          <DataTable
            caption={t.bills.bySupplier}
            rows={summary.data.bySupplier}
            rowKey={(row) => row.supplierId}
            columns={[
              {
                header: t.bills.supplier,
                title: true,
                cell: (row) => (
                  <button type="button" className="text-button" onClick={() => setFilter({ supplier: String(row.supplierId), status: 'open' })}>
                    {row.name}
                  </button>
                ),
              },
              { header: t.bills.openBills, align: 'end', cell: (row) => row.bills },
              { header: t.bills.overdue, align: 'end', cell: (row) => (row.overdue > 0 ? <Badge tone="danger">{formatMoney(row.overdue)}</Badge> : '–') },
              { header: t.bills.owed, align: 'end', cell: (row) => formatMoney(row.owed) },
            ]}
          />
        </Card>
      )}

      {bills.isPending && <Loading />}
      {bills.isError && <ErrorNotice error={bills.error} onRetry={() => bills.refetch()} />}
      {bills.data && (
        <DataTable<SupplierBill>
          caption={t.bills.title}
          rows={bills.data}
          rowKey={(bill) => bill.id}
          toolbar={
            <div className="toolbar">
              <div className="segmented" role="radiogroup" aria-label={t.bills.show}>
                {(['open', 'paid', 'void', 'all'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={status === option}
                    className="segmented__option"
                    onClick={() => setFilter({ status: option })}
                  >
                    {t.bills.filters[option]}
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
            { header: t.bills.due, cell: (bill) => <DueBadge bill={bill} /> },
            { header: t.bills.amount, align: 'end', cell: (bill) => formatMoney(bill.amount) },
            { header: t.bills.left, align: 'end', cell: (bill) => (bill.left > 0 ? <strong>{formatMoney(bill.left)}</strong> : '–') },
            { header: t.bills.status, cell: (bill) => <Badge tone={BILL_STATUS_TONE[bill.status]}>{t.bills.statuses[bill.status]}</Badge> },
          ]}
          empty={
            <EmptyState icon={Receipt} title={status === 'open' && !supplierId ? t.bills.allPaid : t.bills.noneMatch}>
              {status === 'open' && !supplierId ? t.bills.allPaidHint : undefined}
            </EmptyState>
          }
        />
      )}
    </>
  );
}

function NewBillForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const [supplierId, setSupplierId] = useState('');
  const [draft, setDraft] = useState(emptyBill());
  const create = useMutation({
    mutationFn: () => billsApi.create({ supplierId: Number(supplierId), ...toBillInput(draft) }),
    onSuccess: (bill) => {
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      onDone();
      navigate(`/bills/${bill.id}`);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  if (suppliers.data?.length === 0) {
    return (
      <EmptyState title={t.bills.noSuppliers}>
        <Link to="/orders">{t.bills.addSupplier}</Link>
      </EmptyState>
    );
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
        <Button type="submit" variant="primary" disabled={!supplierId || !isBillValid(draft) || create.isPending}>
          {create.isPending ? t.bills.saving : t.bills.save}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}
