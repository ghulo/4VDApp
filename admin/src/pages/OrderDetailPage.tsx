import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, Button, Card, DataTable, PageHeader, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';
import { billsApi, ordersApi } from '../services/api';
import type { OrderLine, PurchaseOrder } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatDateTime, formatMoney } from '../utils/format';
import { BillFields } from '../components/BillParts';
import { emptyBill, isBillValid, toBillInput } from '../utils/bills';

const STATUS_TONE = { open: 'info', received: 'ok', cancelled: 'neutral' } as const;
const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

/** One order from a supplier: what was asked for, what came, what it cost, and its bill. */
export function OrderDetailPage() {
  const t = useT();
  const id = Number(useParams().id);
  const order = useQuery({ queryKey: ['orders', id], queryFn: () => ordersApi.get(id) });

  if (order.isPending) return <Loading />;
  if (order.isError) return <ErrorNotice error={order.error} onRetry={() => order.refetch()} />;
  const o = order.data;
  const received = o.status === 'received';
  const lineTotal = (line: OrderLine) => (line.unitCost === null ? null : roundMoney(line.unitCost * (received ? (line.receivedQuantity ?? 0) : line.quantity)));
  const short = o.lines.filter((line) => received && (line.receivedQuantity ?? 0) < line.quantity).length;

  return (
    <>
      <PageHeader
        title={t.orders.orderNumber(o.id, o.supplier.name)}
        crumbs={[{ label: t.orders.title, to: '/orders' }]}
        meta={<Badge tone={STATUS_TONE[o.status]}>{t.orders.status[o.status]}</Badge>}
        description={[o.supplier.phone, o.supplier.email].filter(Boolean).join(' · ') || undefined}
      />

      <StatGrid>
        <StatTile label={t.orderDetail.ordered} value={formatDateTime(o.createdAt)} hint={o.createdBy ?? undefined} />
        <StatTile
          label={o.status === 'cancelled' ? t.orderDetail.cancelled : t.orderDetail.received}
          value={o.closedAt ? formatDateTime(o.closedAt) : t.orderDetail.notYet}
          hint={o.closedBy ?? undefined}
        />
        <StatTile label={t.orderDetail.cost} value={o.total > 0 ? formatMoney(o.total) : '–'} hint={short > 0 ? t.orderDetail.shortLines(short) : undefined} tone={short > 0 ? 'warn' : 'default'} />
      </StatGrid>

      {o.note && <p className="callout document-note">{o.note}</p>}

      <Card title={t.orderDetail.lines} flush>
        <DataTable
          caption={t.orderDetail.lines}
          rows={o.lines}
          rowKey={(line) => line.id}
          columns={[
            {
              header: t.orders.product,
              title: true,
              cell: (line) => (
                <Link to={`/inventory/${line.productId}`}>
                  {line.productName}
                  {line.sku && <span className="table__secondary"> {line.sku}</span>}
                </Link>
              ),
            },
            { header: t.orderDetail.orderedQty, align: 'end', cell: (line) => line.quantity },
            {
              header: t.orderDetail.cameQty,
              align: 'end',
              cell: (line) =>
                !received ? '–' : (line.receivedQuantity ?? 0) < line.quantity ? <Badge tone="warn">{line.receivedQuantity ?? 0}</Badge> : line.receivedQuantity,
            },
            { header: t.orders.unitCost, align: 'end', cell: (line) => (line.unitCost === null ? '–' : formatMoney(line.unitCost)) },
            { header: t.orderDetail.lineTotal, align: 'end', cell: (line) => (lineTotal(line) === null ? '–' : formatMoney(lineTotal(line)!)) },
          ]}
        />
      </Card>

      {received && <OrderBillCard order={o} />}
    </>
  );
}

function OrderBillCard({ order }: { order: PurchaseOrder }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(emptyBill(order.total > 0 ? String(order.total) : ''));
  const create = useMutation({
    mutationFn: () => billsApi.create({ supplierId: order.supplier.id, orderId: order.id, ...toBillInput(draft) }),
    onSuccess: (bill) => {
      for (const key of ['bills', 'orders']) queryClient.invalidateQueries({ queryKey: [key] });
      navigate(`/bills/${bill.id}`);
    },
  });

  if (order.bill) {
    const bill = order.bill;
    return (
      <Card title={t.orderDetail.bill} actions={<Link to={`/bills/${bill.id}`}>{t.orderDetail.openBill}</Link>}>
        <p>
          {bill.number ? t.bills.numbered(bill.number) : t.bills.noNumber} · {formatMoney(bill.amount)}
          {bill.dueOn && ` · ${t.orderDetail.dueOn(formatDate(bill.dueOn))}`}
        </p>
        <Badge tone={bill.left > 0 ? 'warn' : 'ok'}>{bill.left > 0 ? t.orderDetail.leftToPay(formatMoney(bill.left)) : t.bills.statuses.paid}</Badge>
      </Card>
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <Card title={t.orderDetail.bill} description={t.orderDetail.noBill}>
      <form className="settings-form" onSubmit={handleSubmit}>
        <BillFields draft={draft} onChange={setDraft} />
        {create.isError && (
          <p className="form-error" role="alert">
            {errorMessage(create.error)}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={!isBillValid(draft) || create.isPending}>
            {create.isPending ? t.bills.saving : t.orderDetail.addBill}
          </Button>
        </div>
      </form>
    </Card>
  );
}
