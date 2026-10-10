import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ErrorNotice, Loading } from '../components/Feedback';
import { ManagersOnly } from '../components/ManagersOnly';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { businessApi, ordersApi, productsApi, reportsApi, suppliersApi } from '../services/api';
import type { PurchaseOrder, Supplier } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatMoney } from '../utils/format';
import { Link, useSearchParams } from 'react-router';
import { BillFields } from '../components/BillParts';
import { emptyBill, isBillValid, toBillInput } from '../utils/bills';
import { Badge, Button, Card, DataTable, EmptyState, Field, PageHeader } from '../components/ui';

const STATUS_TONE = { open: 'info', received: 'ok', cancelled: 'neutral' } as const;

/** Ordering from suppliers and ticking off deliveries. */
export function OrdersPage() {
  const t = useT();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const orders = useQuery({ queryKey: ['orders'], queryFn: ordersApi.list });
  const open = orders.data?.filter((order) => order.status === 'open') ?? [];
  const closed = orders.data?.filter((order) => order.status !== 'open') ?? [];

  return (
    <>
      <PageHeader title={t.orders.title} description={t.orders.description} />

      {orders.isPending && <Loading />}
      {orders.isError && <ErrorNotice error={orders.error} onRetry={() => orders.refetch()} />}
      {orders.data && (
        <>
          {open.length === 0 && closed.length === 0 && <EmptyState title={t.orders.noOrders}>{t.orders.noOrdersHint}</EmptyState>}
          {open.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </>
      )}

      <ManagersOnly note={t.orders.managersOnly}>
        {suppliers.data && suppliers.data.length > 0 && (
          <Card title={t.orders.newOrder} id="new-order">
            <NewOrderForm suppliers={suppliers.data} onOrder={new Set(open.flatMap((order) => order.lines.map((line) => line.productId)))} />
          </Card>
        )}
      </ManagersOnly>

      {closed.length > 0 && (
        <Card title={t.orders.closed} flush>
          <DataTable
            caption={t.orders.closed}
            rows={closed}
            rowKey={(row) => row.id}
            columns={[
              {
                header: t.orders.order,
                title: true,
                cell: (row) => (
                  <>
                    <Link to={`/orders/${row.id}`} className="table__primary-link">
                      {t.orders.orderNumber(row.id, row.supplier.name)}
                    </Link>
                    <Link to={`/suppliers/${row.supplier.id}`} className="table__secondary">
                      {t.suppliers.see}
                    </Link>
                  </>
                ),
              },
              {
                header: t.orders.whatCame,
                cell: (row) => (row.status === 'cancelled' ? '–' : row.lines.map((line) => `${line.receivedQuantity ?? 0} × ${line.productName}`).join(', ')),
              },
              { header: t.orders.statusColumn, cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{t.orders.status[row.status]}</Badge> },
              {
                header: t.orderDetail.bill,
                cell: (row) =>
                  row.status !== 'received' ? (
                    '–'
                  ) : row.bill ? (
                    <Link to={`/bills/${row.bill.id}`}>
                      <Badge tone={row.bill.left > 0 ? 'warn' : 'ok'}>{row.bill.left > 0 ? t.orderDetail.leftToPay(formatMoney(row.bill.left)) : t.bills.statuses.paid}</Badge>
                    </Link>
                  ) : (
                    <Link to={`/orders/${row.id}`}>{t.orderDetail.addBill}</Link>
                  ),
              },
              { header: t.orders.closedOn, align: 'end', cell: (row) => (row.closedAt ? formatDate(row.closedAt) : '–') },
            ]}
          />
        </Card>
      )}
    </>
  );
}

interface DraftLine {
  productId: number;
  productName: string;
  include: boolean;
  quantity: string;
  unitCost: string;
}

/** `onOrder`: products already on an open order, so they aren't suggested twice. */
function NewOrderForm({ suppliers, onOrder }: { suppliers: Supplier[]; onOrder: Set<number> }) {
  const t = useT();
  const queryClient = useQueryClient();
  const suggestions = useQuery({ queryKey: ['reports', 'reorder'], queryFn: reportsApi.reorderSuggestions });
  const products = useQuery({ queryKey: ['products', 'all-for-orders'], queryFn: () => productsApi.list({ page: 1, limit: 100 }) });
  const usual = useQuery({ queryKey: ['orders', 'usual-suppliers'], queryFn: ordersApi.usualSuppliers });
  const [params] = useSearchParams();
  // Opened from a supplier's page, the order starts with that supplier chosen.
  const [supplierId, setSupplierId] = useState(() => (suppliers.some((row) => String(row.id) === params.get('supplier')) ? params.get('supplier')! : ''));
  const [extra, setExtra] = useState<DraftLine[]>([]);
  const [edits, setEdits] = useState<Record<number, Partial<DraftLine>>>({});
  const [note, setNote] = useState('');

  const costOf = (productId: number) => products.data?.items.find((product) => product.id === productId)?.costPrice ?? null;
  // Suggested lines: what's running low, for the chosen supplier when we know who usually supplies it.
  const suggested: DraftLine[] = (suggestions.data ?? [])
    .filter((row) => row.suggestedOrder > 0 && !onOrder.has(row.productId))
    .filter((row) => !supplierId || !usual.data?.[row.productId] || usual.data[row.productId] === Number(supplierId))
    .map((row) => ({
      productId: row.productId,
      productName: row.productName,
      include: true,
      quantity: String(row.suggestedOrder),
      unitCost: costOf(row.productId) === null ? '' : String(costOf(row.productId)),
    }));
  const lines = [...suggested, ...extra.filter((line) => !suggested.some((row) => row.productId === line.productId))].map((line) => ({
    ...line,
    ...edits[line.productId],
  }));
  const chosen = lines.filter((line) => line.include && Number(line.quantity) > 0);

  const create = useMutation({
    mutationFn: () =>
      ordersApi.create({
        supplierId: Number(supplierId),
        note: note.trim() || null,
        lines: chosen.map((line) => ({
          productId: line.productId,
          quantity: Number(line.quantity),
          unitCost: line.unitCost.trim() === '' ? null : Number(line.unitCost),
        })),
      }),
    onSuccess: () => {
      for (const key of ['orders', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
      setExtra([]);
      setEdits({});
      setNote('');
    },
  });

  function change(productId: number, patch: Partial<DraftLine>) {
    setEdits((current) => ({ ...current, [productId]: { ...current[productId], ...patch } }));
  }

  function addProduct(value: string) {
    const product = products.data?.items.find((item) => item.id === Number(value));
    if (!product || lines.some((line) => line.productId === product.id)) return;
    setExtra((current) => [
      ...current,
      { productId: product.id, productName: product.name, include: true, quantity: '1', unitCost: product.costPrice == null ? '' : String(product.costPrice) },
    ]);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={t.orders.supplier}>
        <select required value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
          <option value="">{t.orders.chooseSupplier}</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </Field>
      <p className="field-hint">{suggested.length > 0 ? t.orders.suggested : t.orders.nothingToOrder}</p>
      {lines.length > 0 && (
        <DataTable
          caption={t.orders.newOrder}
          rows={lines}
          rowKey={(line) => line.productId}
          rowClassName={(line) => (line.include ? undefined : 'table__row--muted')}
          columns={[
            {
              header: t.orders.product,
              title: true,
              cell: (line) => (
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={line.include}
                    aria-label={t.orders.include(line.productName)}
                    onChange={(event) => change(line.productId, { include: event.target.checked })}
                  />
                  {line.productName}
                </label>
              ),
            },
            {
              header: t.orders.quantity,
              align: 'end',
              cell: (line) => (
                <input
                  className="input--compact"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  aria-label={`${t.orders.quantity}: ${line.productName}`}
                  value={line.quantity}
                  onChange={(event) => change(line.productId, { quantity: event.target.value })}
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
                  value={line.unitCost}
                  onChange={(event) => change(line.productId, { unitCost: event.target.value })}
                />
              ),
            },
          ]}
        />
      )}
      <Field label={t.orders.addProduct}>
        <select value="" onChange={(event) => addProduct(event.target.value)}>
          <option value="">{t.orders.chooseProduct}</option>
          {products.data?.items
            .filter((product) => !lines.some((line) => line.productId === product.id))
            .map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label={t.orders.note}>
        <input maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {create.isError && (
        <p className="form-error" role="alert">
          {errorMessage(create.error)}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={!supplierId || chosen.length === 0 || create.isPending}>
        {create.isPending ? t.orders.creating : t.orders.create}
      </Button>
    </form>
  );
}

function OrderCard({ order }: { order: PurchaseOrder }) {
  const t = useT();
  const { role } = useCurrentUser();
  const queryClient = useQueryClient();
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });
  const [receiving, setReceiving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [came, setCame] = useState<Record<number, string>>(() => Object.fromEntries(order.lines.map((line) => [line.id, String(line.quantity)])));
  const [costs, setCosts] = useState<Record<number, string>>(() =>
    Object.fromEntries(order.lines.map((line) => [line.id, line.unitCost === null ? '' : String(line.unitCost)])),
  );
  const [updateCosts, setUpdateCosts] = useState(false);
  const [expires, setExpires] = useState<Record<number, string>>({});
  const [withBill, setWithBill] = useState(false);
  const [bill, setBill] = useState(emptyBill());

  const invalidate = () => {
    for (const key of ['orders', 'inventory', 'products', 'reports', 'activity', 'notifications', 'bills']) queryClient.invalidateQueries({ queryKey: [key] });
  };
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
    onSuccess: invalidate,
  });
  const cancel = useMutation({ mutationFn: () => ordersApi.cancel(order.id), onSuccess: invalidate });

  /** What the delivery cost at the prices typed in, to start the bill from. */
  function deliveredCost() {
    const sum = order.lines.reduce((total, line) => total + Number(came[line.id] || 0) * Number(costs[line.id] || 0), 0);
    return Math.round(sum * 100) / 100 || '';
  }

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

  const contact = [order.supplier.phone, order.supplier.email].filter(Boolean).join(' · ');

  return (
    <Card
      title={<Link to={`/orders/${order.id}`}>{t.orders.orderNumber(order.id, order.supplier.name)}</Link>}
      description={[t.orders.madeOn(formatDate(order.createdAt), order.createdBy), contact, order.total > 0 ? t.orders.total(formatMoney(order.total)) : null]
        .filter(Boolean)
        .join(' · ')}
      actions={<Badge tone={STATUS_TONE[order.status]}>{t.orders.status[order.status]}</Badge>}
    >
      {!receiving ? (
        <>
          <ul className="plain-list">
            {order.lines.map((line) => (
              <li key={line.id}>
                {line.quantity} × {line.productName}
                {line.unitCost !== null && <span className="table__secondary"> {formatMoney(line.unitCost)}</span>}
              </li>
            ))}
          </ul>
          {order.note && <p className="field-hint">{order.note}</p>}
          <div className="form-actions">
            <Button onClick={copyText}>{t.orders.copy}</Button>
            {canManage(role) && (
              <>
                <Button variant="primary" onClick={() => setReceiving(true)}>
                  {t.orders.receive}
                </Button>
                <Button variant="danger-text" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                  {t.orders.cancel}
                </Button>
              </>
            )}
          </div>
          {copied && (
            <p className="form-success" role="status">
              {t.orders.copied}
            </p>
          )}
        </>
      ) : (
        <div className="settings-form">
          <p className="field-hint">{t.orders.receiveHint}</p>
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
                if (event.target.checked && !bill.amount) setBill({ ...bill, amount: String(deliveredCost()) });
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
            <Button variant="primary" disabled={receive.isPending || (withBill && !isBillValid(bill))} onClick={() => receive.mutate()}>
              {receive.isPending ? t.orders.receiving : t.orders.confirmReceive}
            </Button>
            <Button variant="ghost" onClick={() => setReceiving(false)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
