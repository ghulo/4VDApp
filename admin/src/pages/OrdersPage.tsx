import { Plus, Truck } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, ButtonLink, DataTable, EmptyState, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';
import { ordersApi, suppliersApi } from '../services/api';
import type { PurchaseOrder } from '../services/types';
import { formatDate, formatMoney } from '../utils/format';
import { ORDER_STATUS_TONE, needsBill, orderSummary } from '../utils/orders';

const FILTERS = ['all', 'open', 'nobill', 'cancelled'] as const;
type Filter = (typeof FILTERS)[number];

const MATCHES: Record<Filter, (order: PurchaseOrder) => boolean> = {
  all: () => true,
  open: (order) => order.status === 'open',
  nobill: needsBill,
  cancelled: (order) => order.status === 'cancelled',
};

/** Every order, from the day it's made to its delivery and bill, with the next step on each row. */
export function OrdersPage() {
  const t = useT();
  const navigate = useNavigate();
  const { role } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const orders = useQuery({ queryKey: ['orders'], queryFn: ordersApi.list });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });

  // Old links started a new order on this page; it has its own page now.
  if (hash === '#new-order' || params.has('product')) return <Navigate to={`/orders/new?${params}`} replace />;

  const show = (FILTERS as readonly string[]).includes(params.get('show') ?? '') ? (params.get('show') as Filter) : 'all';
  const supplierId = params.get('supplier') ?? '';
  const all = (orders.data ?? []).filter((order) => !supplierId || String(order.supplier.id) === supplierId);
  const rows = all.filter(MATCHES[show]);
  const manager = canManage(role);
  const setFilter = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader
        title={t.nav.items.suppliers}
        description={t.orders.description}
        actions={
          manager && (
            <ButtonLink to={supplierId ? `/orders/new?supplier=${supplierId}` : '/orders/new'} variant="primary" icon={Plus}>
              {t.orders.newOrder}
            </ButtonLink>
          )
        }
      />

      {orders.isPending && <Loading />}
      {orders.isError && <ErrorNotice error={orders.error} onRetry={() => orders.refetch()} />}
      {orders.data && (
        <DataTable<PurchaseOrder>
          caption={t.orders.title}
          rows={rows}
          rowKey={(order) => order.id}
          onRowClick={(order) => navigate(`/orders/${order.id}`)}
          toolbar={
            (orders.data?.length ?? 0) > 0 && (
              <div className="toolbar">
                <div className="segmented segmented--chips" role="radiogroup" aria-label={t.bills.show}>
                  {FILTERS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={show === option}
                      className="segmented__option"
                      onClick={() => setFilter('show', option === 'all' ? '' : option)}
                    >
                      {t.orders.filters[option]}
                      {option !== 'all' && all.some(MATCHES[option]) && <span className="segmented__count">{all.filter(MATCHES[option]).length}</span>}
                    </button>
                  ))}
                </div>
                <select aria-label={t.orders.supplier} value={supplierId} onChange={(event) => setFilter('supplier', event.target.value)}>
                  <option value="">{t.bills.anySupplier}</option>
                  {suppliers.data?.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </div>
            )
          }
          empty={
            orders.data?.length === 0 ? (
              <EmptyState
                icon={Truck}
                title={t.orders.noOrders}
                action={
                  manager && (
                    <ButtonLink to="/orders/new" variant="primary" icon={Plus}>
                      {t.orders.newOrder}
                    </ButtonLink>
                  )
                }
              >
                {t.orders.noOrdersHint}
              </EmptyState>
            ) : (
              <EmptyState title={t.orders.noneMatch} />
            )
          }
          columns={[
            {
              header: t.orders.order,
              title: true,
              cell: (order) => (
                <Link to={`/orders/${order.id}`} className="table__primary-link">
                  {t.suppliers.orderNo(order.id)}
                  <span className="table__secondary">{formatDate(order.createdAt)}</span>
                </Link>
              ),
            },
            {
              header: t.orders.supplier,
              cell: (order) => <Link to={`/suppliers/${order.supplier.id}`}>{order.supplier.name}</Link>,
            },
            {
              header: t.orders.what,
              cell: (order) => (order.status === 'cancelled' ? <span className="table__secondary">{orderSummary(order, t.orders.andMore)}</span> : orderSummary(order, t.orders.andMore)),
            },
            { header: t.orders.cost, align: 'end', cell: (order) => (order.total > 0 ? formatMoney(order.total) : '–') },
            { header: t.orders.statusColumn, cell: (order) => <Badge tone={ORDER_STATUS_TONE[order.status]}>{t.orders.status[order.status]}</Badge> },
            { header: t.orders.next, align: 'end', cell: (order) => <NextStep order={order} manager={manager} /> },
          ]}
        />
      )}
    </>
  );
}

/** What this order is waiting for, as one button or stamp. */
function NextStep({ order, manager }: { order: PurchaseOrder; manager: boolean }) {
  const t = useT();
  if (order.status === 'open') {
    return manager ? (
      <ButtonLink to={`/orders/${order.id}?receive=1`} size="sm" aria-label={t.orders.receiveLabel(order.id)}>
        {t.orders.receiveShort}
      </ButtonLink>
    ) : (
      '–'
    );
  }
  if (needsBill(order)) {
    return manager ? (
      <ButtonLink to={`/orders/${order.id}#bill`} size="sm" aria-label={t.orders.addBillLabel(order.id)}>
        {t.orderDetail.addBill}
      </ButtonLink>
    ) : (
      <Badge tone="warn">{t.orders.needsBill}</Badge>
    );
  }
  if (order.bill) {
    return (
      <Link to={`/bills/${order.bill.id}`}>
        <Badge tone={order.bill.left > 0 ? 'warn' : 'ok'}>{order.bill.left > 0 ? t.orderDetail.leftToPay(formatMoney(order.bill.left)) : t.bills.statuses.paid}</Badge>
      </Link>
    );
  }
  return '–';
}
