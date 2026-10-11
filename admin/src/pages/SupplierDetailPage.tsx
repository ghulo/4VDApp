import { Invoice, Truck } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { DueBadge } from '../components/BillParts';
import { ErrorNotice, Loading } from '../components/Feedback';
import { SupplierForm } from '../components/SupplierForm';
import { Badge, Button, ButtonLink, Card, DataTable, EmptyState, PageHeader, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';
import { billsApi, ordersApi, reportsApi, suppliersApi } from '../services/api';
import type { PurchaseOrder, Supplier } from '../services/types';
import { BILL_STATUS_TONE } from '../utils/bills';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';
import { ORDER_STATUS_TONE, orderSummary } from '../utils/orders';
import { HistoryCard } from '../components/HistoryCard';

/** One supplier on one page: what is on the way, what is owed, and every order and bill. */
export function SupplierDetailPage() {
  const t = useT();
  const id = Number(useParams().id);
  const { role } = useCurrentUser();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const orders = useQuery({ queryKey: ['orders'], queryFn: ordersApi.list });
  const bills = useQuery({ queryKey: ['bills', { supplierId: id }], queryFn: () => billsApi.list({ supplierId: id }) });
  const reorder = useQuery({ queryKey: ['reports', 'reorder'], queryFn: reportsApi.reorderSuggestions });
  const usual = useQuery({ queryKey: ['orders', 'usual-suppliers'], queryFn: ordersApi.usualSuppliers });

  if (suppliers.isPending) return <Loading />;
  if (suppliers.isError) return <ErrorNotice error={suppliers.error} onRetry={() => suppliers.refetch()} />;
  const supplier = suppliers.data.find((row) => row.id === id);
  if (!supplier) return <EmptyState title={t.suppliers.notFound} action={<ButtonLink to="/suppliers">{t.suppliers.back}</ButtonLink>} />;

  const theirOrders = orders.data?.filter((order) => order.supplier.id === id) ?? [];
  const onTheWay = theirOrders.filter((order) => order.status === 'open');
  const unpaid = bills.data?.filter((bill) => bill.status !== 'void' && bill.left > 0) ?? [];
  const owed = unpaid.reduce((sum, bill) => sum + bill.left, 0);
  const overdue = unpaid.filter((bill) => bill.overdue).reduce((sum, bill) => sum + bill.left, 0);
  const lowFromThem = (reorder.data ?? []).filter((row) => row.suggestedOrder > 0 && usual.data?.[row.productId] === id).length;

  return (
    <>
      <PageHeader
        title={supplier.name}
        crumbs={[{ label: t.suppliers.title, to: '/suppliers' }]}
        description={[supplier.nui && t.nui.short(supplier.nui), supplier.phone, supplier.email].filter(Boolean).join(' · ') || undefined}
        actions={
          canManage(role) && (
            <>
              <ButtonLink to={`/bills?supplier=${id}&new=1`} icon={Invoice}>
                {t.suppliers.addBill}
              </ButtonLink>
              <ButtonLink to={`/orders/new?supplier=${id}`} variant="primary" icon={Truck}>
                {t.suppliers.newOrder}
              </ButtonLink>
            </>
          )
        }
      />

      <StatGrid>
        <StatTile label={t.bills.owed} value={formatMoney(owed)} hint={t.bills.billsCount(unpaid.length)} to={`/bills?supplier=${id}`} />
        <StatTile label={t.bills.overdue} value={formatMoney(overdue)} tone={overdue > 0 ? 'danger' : 'default'} to={`/bills?supplier=${id}&status=overdue`} />
        <StatTile label={t.orders.onTheWay} value={onTheWay.length} hint={onTheWay.length > 0 ? t.suppliers.ordersWaiting : undefined} to={`/orders?supplier=${id}&show=open`} />
        <StatTile
          label={t.suppliers.runningLow}
          value={lowFromThem}
          hint={lowFromThem > 0 ? t.suppliers.toReorder(lowFromThem) : t.suppliers.nothingLow}
          tone={lowFromThem > 0 ? 'warn' : 'default'}
          to={canManage(role) && lowFromThem > 0 ? `/orders/new?supplier=${id}` : undefined}
        />
      </StatGrid>

      {bills.isError && <ErrorNotice error={bills.error} onRetry={() => bills.refetch()} />}
      <Card title={t.suppliers.bills} flush actions={<Link to={`/bills?supplier=${id}&status=all`}>{t.suppliers.allBills}</Link>}>
        <DataTable
          caption={t.suppliers.bills}
          rows={bills.data ?? []}
          rowKey={(bill) => bill.id}
          empty={<EmptyState title={bills.isPending ? t.common.loading : t.suppliers.noBills} />}
          columns={[
            {
              header: t.bills.bill,
              title: true,
              cell: (bill) => (
                <Link to={`/bills/${bill.id}`} className="table__primary-link">
                  {bill.number ? t.bills.numbered(bill.number) : t.bills.noNumber}
                  <span className="table__secondary">{formatDate(bill.issuedOn)}</span>
                </Link>
              ),
            },
            { header: t.bills.due, cell: (bill) => (bill.left > 0 ? <DueBadge bill={bill} /> : '–') },
            { header: t.bills.amount, align: 'end', cell: (bill) => formatMoney(bill.amount) },
            { header: t.bills.left, align: 'end', cell: (bill) => (bill.left > 0 ? <strong>{formatMoney(bill.left)}</strong> : '–') },
            { header: t.bills.status, cell: (bill) => <Badge tone={BILL_STATUS_TONE[bill.status]}>{t.bills.statuses[bill.status]}</Badge> },
          ]}
        />
      </Card>

      {orders.isError && <ErrorNotice error={orders.error} onRetry={() => orders.refetch()} />}
      <OrdersCard supplierId={id} orders={theirOrders} isPending={orders.isPending} />

      {canManage(role) && <DetailsCard supplier={supplier} />}
      <HistoryCard entityType="supplier" entityId={id} />
    </>
  );
}

function OrdersCard({ supplierId, orders, isPending }: { supplierId: number; orders: PurchaseOrder[]; isPending: boolean }) {
  const t = useT();
  return (
    <Card title={t.suppliers.orders} flush actions={<Link to={`/orders?supplier=${supplierId}`}>{t.suppliers.allOrders}</Link>}>
      <DataTable
        caption={t.suppliers.orders}
        rows={orders}
        rowKey={(order) => order.id}
        empty={<EmptyState title={isPending ? t.common.loading : t.suppliers.noOrders} />}
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
          { header: t.suppliers.items, cell: (order) => orderSummary(order, t.orders.andMore) },
          { header: t.orders.statusColumn, cell: (order) => <Badge tone={ORDER_STATUS_TONE[order.status]}>{t.orders.status[order.status]}</Badge> },
          {
            header: t.orderDetail.bill,
            cell: (order) =>
              order.status !== 'received' ? (
                '–'
              ) : order.bill ? (
                <Link to={`/bills/${order.bill.id}`}>{order.bill.left > 0 ? t.orderDetail.leftToPay(formatMoney(order.bill.left)) : t.bills.statuses.paid}</Link>
              ) : (
                <Link to={`/orders/${order.id}`}>{t.orderDetail.addBill}</Link>
              ),
          },
        ]}
      />
    </Card>
  );
}

/** Managers fix the supplier's details, or remove a supplier added by mistake. */
function DetailsCard({ supplier }: { supplier: Supplier }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => suppliersApi.remove(supplier.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      navigate('/suppliers');
    },
  });

  return (
    <Card title={t.suppliers.details}>
      {editing ? (
        <SupplierForm key={supplier.id} supplier={supplier} onDone={() => setEditing(false)} />
      ) : (
        <div className="form-actions">
          <Button onClick={() => setEditing(true)}>{t.suppliers.edit}</Button>
          {confirming ? (
            <span className="inline-confirm">
              <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {t.suppliers.confirmRemove(supplier.name)}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t.common.cancel}
              </Button>
            </span>
          ) : (
            <Button variant="danger-text" onClick={() => setConfirming(true)}>
              {t.suppliers.remove}
            </Button>
          )}
        </div>
      )}
      {remove.isError && (
        <p className="form-error" role="alert">
          {errorMessage(remove.error)}
        </p>
      )}
    </Card>
  );
}
