import { Copy, Truck } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { BillFields } from '../components/BillParts';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, Button, ButtonLink, Card, DataTable, PageHeader, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';
import { billsApi, businessApi, ordersApi } from '../services/api';
import type { OrderLine, PurchaseOrder } from '../services/types';
import { emptyBill, isBillValid, toBillInput } from '../utils/bills';
import { errorMessage } from '../utils/errors';
import { formatDate, formatDateTime, formatMoney } from '../utils/format';
import { ORDER_STATUS_TONE } from '../utils/orders';
import { HistoryCard } from '../components/HistoryCard';

const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

/** One order from a supplier: what was asked for, receiving it, what came, what it cost, and its bill. */
export function OrderDetailPage() {
  const t = useT();
  const id = Number(useParams().id);
  const { role } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const order = useQuery({ queryKey: ['orders', id], queryFn: () => ordersApi.get(id) });

  if (order.isPending) return <Loading />;
  if (order.isError) return <ErrorNotice error={order.error} onRetry={() => order.refetch()} />;
  const o = order.data;
  const manager = canManage(role);
  const receiving = manager && o.status === 'open' && params.get('receive') === '1';
  const setReceiving = (open: boolean) => setParams(open ? { receive: '1' } : {}, { replace: true });
  const received = o.status === 'received';
  const lineTotal = (line: OrderLine) => (line.unitCost === null ? null : roundMoney(line.unitCost * (received ? (line.receivedQuantity ?? 0) : line.quantity)));
  const short = o.lines.filter((line) => received && (line.receivedQuantity ?? 0) < line.quantity).length;

  return (
    <>
      <PageHeader
        title={t.suppliers.orderNo(o.id)}
        crumbs={[{ label: t.orders.title, to: '/orders' }]}
        meta={<Badge tone={ORDER_STATUS_TONE[o.status]}>{t.orders.status[o.status]}</Badge>}
        description={
          <>
            <Link to={`/suppliers/${o.supplier.id}`}>{o.supplier.name}</Link>
            {[o.supplier.phone, o.supplier.email].filter(Boolean).map((part) => ` · ${part}`)}
          </>
        }
        actions={
          o.status === 'open' && (
            <>
              <CopyOrderButton order={o} />
              {manager && !receiving && (
                <Button variant="primary" icon={Truck} onClick={() => setReceiving(true)}>
                  {t.orders.receive}
                </Button>
              )}
            </>
          )
        }
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

      {receiving ? (
        <ReceiveCard order={o} onClose={() => setReceiving(false)} />
      ) : (
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
                  <Link to={`/products/${line.productId}`}>
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
      )}

      {received && <OrderBillCard order={o} />}
      {manager && o.status === 'open' && !receiving && <CancelOrder order={o} />}
      <HistoryCard entityType="order" entityId={o.id} />
    </>
  );
}

function useOrderSaved() {
  const queryClient = useQueryClient();
  return (updated: PurchaseOrder) => {
    queryClient.setQueryData(['orders', updated.id], updated);
    for (const key of ['orders', 'inventory', 'products', 'reports', 'activity', 'notifications', 'bills', 'attention']) queryClient.invalidateQueries({ queryKey: [key] });
  };
}

/** The order as a message to paste into a chat or email to the supplier. */
function CopyOrderButton({ order }: { order: PurchaseOrder }) {
  const t = useT();
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });
  const [copied, setCopied] = useState(false);

  async function copyText() {
    const text = t.orders.orderText({
      supplier: order.supplier.name,
      shop: business.data?.name ?? '4VD',
      lines: order.lines.map((line) => `- ${line.quantity} × ${line.productName}${line.sku ? ` (${line.sku})` : ''}`),
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <Button icon={Copy} onClick={copyText}>
        {t.orders.copy}
      </Button>
      <span className="field-hint" role="status">
        {copied ? t.orders.copied : ''}
      </span>
    </>
  );
}

/** Ticking off a delivery: what came, at what price, when it expires, and the bill if it came along. */
function ReceiveCard({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const t = useT();
  const onSaved = useOrderSaved();
  const [came, setCame] = useState<Record<number, string>>(() => Object.fromEntries(order.lines.map((line) => [line.id, String(line.quantity)])));
  const [costs, setCosts] = useState<Record<number, string>>(() =>
    Object.fromEntries(order.lines.map((line) => [line.id, line.unitCost === null ? '' : String(line.unitCost)])),
  );
  const [updateCosts, setUpdateCosts] = useState(false);
  const [expires, setExpires] = useState<Record<number, string>>({});
  const [withBill, setWithBill] = useState(false);
  const [bill, setBill] = useState(emptyBill());

  const receive = useMutation({
    mutationFn: () =>
      ordersApi.receive(order.id, {
        updateCostPrices: updateCosts,
        ...(withBill && { bill: toBillInput(bill) }),
        lines: order.lines.map((line) => ({
          lineId: line.id,
          receivedQuantity: Number(came[line.id] || 0),
          unitCost: costs[line.id]?.trim() ? Number(costs[line.id]) : null,
          expiresOn: expires[line.id] || null,
        })),
      }),
    onSuccess: (updated) => {
      onSaved(updated);
      onClose();
    },
  });

  /** What the delivery cost at the prices typed in, to start the bill from. */
  const deliveredCost = () => roundMoney(order.lines.reduce((total, line) => total + Number(came[line.id] || 0) * Number(costs[line.id] || 0), 0));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    receive.mutate();
  }

  return (
    <Card title={t.orders.receive} description={t.orders.receiveHint} flush>
      <form onSubmit={handleSubmit}>
        <DataTable
          caption={t.orders.receive}
          rows={order.lines}
          rowKey={(line) => line.id}
          columns={[
            {
              header: t.orders.product,
              title: true,
              cell: (line) => (
                <>
                  {line.productName}
                  <span className="table__secondary">{t.orders.ofOrdered(Number(came[line.id] || 0), line.quantity)}</span>
                </>
              ),
            },
            {
              header: t.orders.received,
              align: 'end',
              cell: (line) => (
                <input
                  className="input--compact"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  aria-label={`${t.orders.received}: ${line.productName}`}
                  value={came[line.id]}
                  onChange={(event) => setCame((current) => ({ ...current, [line.id]: event.target.value }))}
                />
              ),
            },
            {
              header: t.orders.unitCost,
              align: 'end',
              cell: (line) => (
                <input
                  className="input--compact"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                  aria-label={`${t.orders.unitCost}: ${line.productName}`}
                  value={costs[line.id]}
                  onChange={(event) => setCosts((current) => ({ ...current, [line.id]: event.target.value }))}
                />
              ),
            },
            {
              header: t.orders.expiresOn,
              cell: (line) => (
                <input
                  type="date"
                  aria-label={`${t.orders.expiresOn}: ${line.productName}`}
                  value={expires[line.id] ?? ''}
                  onChange={(event) => setExpires((current) => ({ ...current, [line.id]: event.target.value }))}
                />
              ),
            },
          ]}
        />
        <div className="settings-form buy-receive__options">
          <label className="toggle">
            <input type="checkbox" checked={updateCosts} onChange={(event) => setUpdateCosts(event.target.checked)} />
            {t.orders.updateCosts}
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={withBill}
              onChange={(event) => {
                setWithBill(event.target.checked);
                if (event.target.checked && !bill.amount) setBill({ ...bill, amount: String(deliveredCost() || '') });
              }}
            />
            {t.orderDetail.billCame}
          </label>
          {withBill && <BillFields draft={bill} onChange={setBill} />}
          {receive.isError && (
            <p className="form-error" role="alert">
              {errorMessage(receive.error)}
            </p>
          )}
          <div className="form-actions">
            <Button variant="ghost" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={receive.isPending || (withBill && !isBillValid(bill))}>
              {receive.isPending ? t.orders.receiving : t.orders.confirmReceive}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

/** Calling off an order that won't come, after one confirm. */
function CancelOrder({ order }: { order: PurchaseOrder }) {
  const t = useT();
  const onSaved = useOrderSaved();
  const [confirming, setConfirming] = useState(false);
  const cancel = useMutation({ mutationFn: () => ordersApi.cancel(order.id), onSuccess: onSaved });

  return (
    <div className="danger-zone">
      {confirming ? (
        <>
          <p className="field-hint">{t.orders.cancelHint}</p>
          <span className="inline-confirm">
            <Button variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {t.orders.confirmCancel}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t.orders.keep}
            </Button>
          </span>
        </>
      ) : (
        <span>
          <Button variant="danger-text" onClick={() => setConfirming(true)}>
            {t.orders.cancel}
          </Button>
        </span>
      )}
      {cancel.isError && (
        <p className="form-error" role="alert">
          {errorMessage(cancel.error)}
        </p>
      )}
    </div>
  );
}

function OrderBillCard({ order }: { order: PurchaseOrder }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const [draft, setDraft] = useState(emptyBill(order.total > 0 ? String(order.total) : ''));
  // Opened from the Orders list's "Add the bill", go straight to it.
  useEffect(() => {
    if (window.location.hash === '#bill') document.getElementById('bill')?.scrollIntoView({ block: 'start' });
  }, []);
  const create = useMutation({
    mutationFn: () => billsApi.create({ supplierId: order.supplier.id, orderId: order.id, ...toBillInput(draft) }),
    onSuccess: (bill) => {
      for (const key of ['bills', 'orders', 'attention']) queryClient.invalidateQueries({ queryKey: [key] });
      navigate(`/bills/${bill.id}`);
    },
  });

  if (order.bill) {
    const bill = order.bill;
    return (
      <Card title={t.orderDetail.bill} id="bill" actions={<ButtonLink to={`/bills/${bill.id}`} size="sm">{t.orderDetail.openBill}</ButtonLink>}>
        <div className="buy-bill-line">
          <span>
            {bill.number ? t.bills.numbered(bill.number) : t.bills.noNumber} · {formatMoney(bill.amount)}
            {bill.dueOn && ` · ${t.orderDetail.dueOn(formatDate(bill.dueOn))}`}
          </span>
          <Badge tone={bill.left > 0 ? 'warn' : 'ok'}>{bill.left > 0 ? t.orderDetail.leftToPay(formatMoney(bill.left)) : t.bills.statuses.paid}</Badge>
        </div>
      </Card>
    );
  }
  if (!canManage(role)) return null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <Card title={t.orderDetail.addBill} description={t.orderDetail.noBill} id="bill">
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
