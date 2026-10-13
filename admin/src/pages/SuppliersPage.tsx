import { Plus, Truck } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { SearchInput } from '../components/SearchInput';
import { SupplierForm } from '../components/SupplierForm';
import { Badge, Button, ButtonLink, DataTable, EmptyState, PageHeader, Sheet, StatGrid, StatTile, useNewSheet } from '../components/ui';
import { useT } from '../i18n/useT';
import { billsApi, ordersApi, reportsApi, suppliersApi } from '../services/api';
import type { Supplier } from '../services/types';
import { formatDate, formatHeadlineMoney, formatMoney } from '../utils/format';

/** Everyone the shop buys from: what is owed, what is on the way, and what to order from whom. */
export function SuppliersPage() {
  const t = useT();
  const navigate = useNavigate();
  const { role } = useCurrentUser();
  const [adding, setAdding] = useNewSheet();
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const summary = useQuery({ queryKey: ['bills', 'summary'], queryFn: billsApi.summary });
  const orders = useQuery({ queryKey: ['orders'], queryFn: ordersApi.list });
  const reorder = useQuery({ queryKey: ['reports', 'reorder'], queryFn: reportsApi.reorderSuggestions });
  const usual = useQuery({ queryKey: ['orders', 'usual-suppliers'], queryFn: ordersApi.usualSuppliers });
  const manager = canManage(role);

  const owedBy = new Map(summary.data?.bySupplier.map((row) => [row.supplierId, row]));
  const allOrders = orders.data ?? [];
  const onTheWay = allOrders.filter((order) => order.status === 'open');
  const openOrders = (supplierId: number) => onTheWay.filter((order) => order.supplier.id === supplierId).length;
  const lastDelivery = (supplierId: number) =>
    allOrders.find((order) => order.status === 'received' && order.supplier.id === supplierId)?.closedAt ?? null;
  const toReorder = (reorder.data ?? []).filter((row) => row.suggestedOrder > 0);
  const lowFrom = (supplierId: number) => toReorder.filter((row) => usual.data?.[row.productId] === supplierId).length;
  const needle = search.toLowerCase();
  const rows = (suppliers.data ?? []).filter(
    (row) => !needle || [row.name, row.phone, row.email, row.nui].some((value) => value?.toLowerCase().includes(needle)),
  );

  return (
    <>
      <PageHeader
        title={t.suppliers.title}
        description={t.suppliers.description}
        actions={
          manager && (
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              {t.suppliers.add}
            </Button>
          )
        }
      />

      <Sheet open={adding} onClose={() => setAdding(false)} title={t.suppliers.add} description={t.suppliers.addHint}>
        <SupplierForm
          supplier={null}
          onDone={(saved) => {
            setAdding(false);
            if (saved) navigate(`/suppliers/${saved.id}`);
          }}
        />
      </Sheet>

      {suppliers.data && suppliers.data.length > 0 && summary.data && (
        <StatGrid>
          <StatTile
            label={t.bills.owed}
            value={formatHeadlineMoney(summary.data.owed)}
            hint={summary.data.bySupplier.length > 0 ? t.bills.suppliersCount(summary.data.bySupplier.length) : undefined}
            to="/bills"
          />
          <StatTile
            label={t.bills.overdue}
            value={formatHeadlineMoney(summary.data.overdue.amount)}
            hint={summary.data.overdue.count > 0 ? t.bills.billsCount(summary.data.overdue.count) : undefined}
            tone={summary.data.overdue.count > 0 ? 'danger' : 'default'}
            to="/bills?status=overdue"
          />
          <StatTile label={t.orders.onTheWay} value={onTheWay.length} hint={onTheWay.length > 0 ? t.suppliers.ordersCount(onTheWay.length) : undefined} to="/orders?show=open" />
          <StatTile
            label={t.suppliers.runningLow}
            value={toReorder.length}
            hint={toReorder.length > 0 ? t.suppliers.toReorder(toReorder.length) : t.suppliers.nothingLow}
            tone={toReorder.length > 0 ? 'warn' : 'default'}
            to={manager ? '/orders/new' : undefined}
          />
        </StatGrid>
      )}

      {suppliers.isPending && <Loading />}
      {suppliers.isError && <ErrorNotice error={suppliers.error} onRetry={() => suppliers.refetch()} />}
      {suppliers.data && (
        <DataTable<Supplier>
          caption={t.suppliers.title}
          rows={rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/suppliers/${row.id}`)}
          toolbar={
            suppliers.data.length > 0 && (
              <div className="toolbar">
                <SearchInput value={search} label={t.suppliers.search} onChange={(value) => setParams(value ? { search: value } : {}, { replace: true })} />
              </div>
            )
          }
          empty={
            suppliers.data.length === 0 ? (
              <EmptyState
                icon={Truck}
                title={t.orders.noSuppliers}
                action={
                  manager && (
                    <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
                      {t.suppliers.add}
                    </Button>
                  )
                }
              >
                {t.orders.noSuppliersHint}
              </EmptyState>
            ) : (
              <EmptyState title={t.suppliers.noMatch} />
            )
          }
          columns={[
            {
              header: t.orders.supplierName,
              title: true,
              cell: (row) => (
                <Link to={`/suppliers/${row.id}`} className="table__primary-link">
                  {row.name}
                  <span className="table__secondary">{[row.phone, row.email].filter(Boolean).join(' · ') || (row.nui ? t.nui.short(row.nui) : '')}</span>
                </Link>
              ),
            },
            {
              header: t.orders.onTheWay,
              align: 'end',
              cell: (row) => (openOrders(row.id) > 0 ? <Badge tone="info">{t.suppliers.ordersCount(openOrders(row.id))}</Badge> : '–'),
            },
            {
              header: t.suppliers.lastDelivery,
              cell: (row) => (lastDelivery(row.id) ? formatDate(lastDelivery(row.id)!) : '–'),
            },
            {
              header: t.bills.overdue,
              align: 'end',
              cell: (row) => {
                const overdue = owedBy.get(row.id)?.overdue ?? 0;
                return overdue > 0 ? <Badge tone="danger">{formatMoney(overdue)}</Badge> : '–';
              },
            },
            {
              header: t.bills.owed,
              align: 'end',
              cell: (row) => {
                const owed = owedBy.get(row.id)?.owed ?? 0;
                return owed > 0 ? <strong>{formatMoney(owed)}</strong> : '–';
              },
            },
            ...(manager
              ? [
                  {
                    header: <span className="visually-hidden">{t.bills.actions}</span>,
                    align: 'end' as const,
                    cell: (row: Supplier) => (
                      <ButtonLink to={`/orders/new?supplier=${row.id}`} size="sm" aria-label={t.suppliers.orderFrom(row.name)}>
                        {t.suppliers.order}
                        {lowFrom(row.id) > 0 && <span className="segmented__count">{lowFrom(row.id)}</span>}
                      </ButtonLink>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </>
  );
}
