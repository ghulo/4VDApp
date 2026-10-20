import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Button, ButtonLink, Card, Combobox, DataTable, EmptyState, Field, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';
import { ordersApi, productsApi, reportsApi, suppliersApi } from '../services/api';
import type { Supplier } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { useWarnBeforeLeaving } from '../utils/useWarnBeforeLeaving';

interface DraftLine {
  productId: number;
  productName: string;
  include: boolean;
  quantity: string;
  unitCost: string;
}

const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

/** A new order: pick the supplier, start from what's running low, then save and send it. */
export function NewOrderPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const orders = useQuery({ queryKey: ['orders'], queryFn: ordersApi.list });

  const header = <PageHeader title={t.orders.newOrder} crumbs={[{ label: t.orders.title, to: '/orders' }]} description={t.orders.newOrderHint} />;
  if (!canManage(role)) {
    return (
      <>
        {header}
        <EmptyState title={t.orders.managersOnly} action={<ButtonLink to="/orders">{t.orders.title}</ButtonLink>} />
      </>
    );
  }
  if (suppliers.isPending || orders.isPending) return <Loading />;
  if (suppliers.isError) return <ErrorNotice error={suppliers.error} onRetry={() => suppliers.refetch()} />;
  if (orders.isError) return <ErrorNotice error={orders.error} onRetry={() => orders.refetch()} />;

  return (
    <>
      {header}
      {suppliers.data.length === 0 ? (
        <EmptyState
          title={t.orders.noSuppliers}
          action={
            <ButtonLink to="/suppliers?new=1" variant="primary">
              {t.orders.addSupplier}
            </ButtonLink>
          }
        >
          {t.orders.noSuppliersHint}
        </EmptyState>
      ) : (
        <NewOrderForm
          suppliers={suppliers.data}
          onOrder={new Set(orders.data.filter((order) => order.status === 'open').flatMap((order) => order.lines.map((line) => line.productId)))}
        />
      )}
    </>
  );
}

/** `onOrder`: products already on an open order, so they aren't suggested twice. */
function NewOrderForm({ suppliers, onOrder }: { suppliers: Supplier[]; onOrder: Set<number> }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const suggestions = useQuery({ queryKey: ['reports', 'reorder'], queryFn: reportsApi.reorderSuggestions });
  const products = useQuery({ queryKey: ['products', 'all-for-orders'], queryFn: () => productsApi.list({ page: 1, limit: 100 }) });
  const usual = useQuery({ queryKey: ['orders', 'usual-suppliers'], queryFn: ordersApi.usualSuppliers });
  // Opened from a supplier's page, the order starts with that supplier chosen.
  const [supplierId, setSupplierId] = useState(() => (suppliers.some((row) => String(row.id) === params.get('supplier')) ? params.get('supplier')! : ''));
  // Opened from a product's Order button on Stock, only that product starts ticked.
  const focus = Number(params.get('product')) || null;
  const [extra, setExtra] = useState<DraftLine[]>([]);
  const [edits, setEdits] = useState<Record<number, Partial<DraftLine>>>({});
  const [note, setNote] = useState('');

  const supplier = suppliers.find((row) => String(row.id) === supplierId);
  const costOf = (productId: number) => products.data?.items.find((product) => product.id === productId)?.costPrice ?? null;
  // Suggested lines: what's running low, for the chosen supplier when we know who usually supplies it.
  const suggested: DraftLine[] = (suggestions.data ?? [])
    .filter((row) => row.suggestedOrder > 0 && !onOrder.has(row.productId))
    .filter((row) => !supplierId || !usual.data?.[row.productId] || usual.data[row.productId] === Number(supplierId))
    .map((row) => ({
      productId: row.productId,
      productName: row.productName,
      include: focus === null || row.productId === focus,
      quantity: String(row.suggestedOrder),
      unitCost: costOf(row.productId) === null ? '' : String(costOf(row.productId)),
    }));
  const lines = [...suggested, ...extra.filter((line) => !suggested.some((row) => row.productId === line.productId))].map((line) => ({
    ...line,
    ...edits[line.productId],
  }));
  const chosen = lines.filter((line) => line.include && Number(line.quantity) > 0);
  const lineCost = (line: DraftLine) => (line.unitCost.trim() === '' ? null : roundMoney(Number(line.quantity) * Number(line.unitCost)));
  const priced = chosen.filter((line) => lineCost(line) !== null);
  const estimate = roundMoney(priced.reduce((sum, line) => sum + (lineCost(line) ?? 0), 0));
  const units = chosen.reduce((sum, line) => sum + Number(line.quantity), 0);
  const blocker = !supplierId ? t.orders.needSupplier : chosen.length === 0 ? t.orders.needLines : null;

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
    onSuccess: (order) => {
      for (const key of ['orders', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
      navigate(`/orders/${order.id}`);
    },
  });
  useWarnBeforeLeaving((extra.length > 0 || Object.keys(edits).length > 0 || note.trim() !== '') && !create.isPending && !create.isSuccess);

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
    <form className="product-layout" onSubmit={handleSubmit}>
      <div className="product-layout__main">
        <Card>
          <Combobox
            label={t.orders.supplier}
            hint={supplier ? [supplier.phone, supplier.email].filter(Boolean).join(' · ') || undefined : undefined}
            placeholder={t.orders.chooseSupplier}
            required
            value={supplierId}
            onChange={setSupplierId}
            options={suppliers.map((row) => ({ value: String(row.id), label: row.name, hint: row.nui ?? row.phone ?? undefined }))}
          />
        </Card>

        <Card
          title={t.orders.whatToOrder}
          description={suggestions.isPending ? t.common.loading : suggested.length > 0 ? t.orders.suggested : t.orders.nothingToOrder}
          flush
        >
          {suggestions.isError && <ErrorNotice error={suggestions.error} onRetry={() => suggestions.refetch()} />}
          {lines.length > 0 && (
            <DataTable
              caption={t.orders.whatToOrder}
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
                {
                  header: t.orderDetail.lineTotal,
                  align: 'end',
                  cell: (line) => (line.include && lineCost(line) !== null ? formatMoney(lineCost(line)!) : '–'),
                },
              ]}
            />
          )}
          <div className="buy-add-line">
            <Combobox
              label={t.orders.addProduct}
              placeholder={t.orders.chooseProduct}
              disabled={products.isPending}
              value=""
              resetAfterPick
              onChange={(id) => id && addProduct(id)}
              options={(products.data?.items ?? [])
                .filter((product) => !lines.some((line) => line.productId === product.id))
                .map((product) => ({ value: String(product.id), label: product.name, hint: product.barcode ?? undefined }))}
            />
          </div>
        </Card>
      </div>

      <div className="product-layout__side buy-side">
        <Card title={t.orders.summary}>
          <dl className="buy-summary">
            <div>
              <dt>{t.orders.supplier}</dt>
              <dd>{supplier ? <Link to={`/suppliers/${supplier.id}`}>{supplier.name}</Link> : '–'}</dd>
            </div>
            <div>
              <dt>{t.orders.whatToOrder}</dt>
              <dd>
                {t.orders.productsCount(chosen.length)} · {t.orders.unitsCount(units)}
              </dd>
            </div>
            <div className="buy-summary__total">
              <dt>{t.orders.estimate}</dt>
              <dd>{priced.length > 0 ? formatMoney(estimate) : <span className="table__secondary">{t.orders.noEstimate}</span>}</dd>
            </div>
          </dl>
          <Field label={t.orders.note}>
            <textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {create.isError && (
            <p className="form-error" role="alert">
              {errorMessage(create.error)}
            </p>
          )}
          <Button type="submit" variant="primary" wide disabled={blocker !== null || create.isPending} aria-describedby="new-order-why" loading={create.isPending}>
            {t.orders.create}
          </Button>
          <p id="new-order-why" className="field-hint">
            {blocker ?? t.orders.afterSave}
          </p>
        </Card>
      </div>
    </form>
  );
}
