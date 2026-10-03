import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, type FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { ReturnForm } from '../components/ReturnForm';
import { Pagination } from '../components/Pagination';
import { productsApi, salesApi } from '../services/api';
import type { PricingTier, Product } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateTime, formatMoney } from '../utils/format';
import { Button, Card, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';

/** Same rule as the backend: the biggest tier the quantity reaches. */
function unitPriceFor(product: Product, quantity: number): number {
  return product.bulkPricingTiers.reduce(
    (price: number, tier: PricingTier) => (quantity >= tier.quantity ? tier.price : price),
    product.price,
  );
}

export function SalesPage() {
  const t = useT();
  return (
    <>
      <PageHeader
        title={t.sales.title}
        description={t.sales.description}
      />
      <Card title={t.sales.record}>
        <RecordSaleForm />
      </Card>
      <SalesHistory />
    </>
  );
}

function RecordSaleForm() {
  const t = useT();
  const queryClient = useQueryClient();
  const products = useQuery({
    queryKey: ['products', { page: 1, limit: 100, inStock: true }],
    queryFn: () => productsApi.list({ page: 1, limit: 100, inStock: true }),
  });
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: salesApi.record,
    onSuccess: (sale) => {
      for (const key of ['sales', 'inventory', 'products', 'analytics', 'notifications', 'reports', 'activity']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      setSavedMessage(t.sales.sold({ quantity: sale.quantity, product: sale.productName, amount: formatMoney(sale.totalAmount) }));
      setQuantity('1');
      setNotes('');
    },
  });

  // Only active products are sellable; the list endpoint returns hidden ones to admins too.
  const sellable = products.data?.items.filter((product) => product.isActive) ?? [];
  const selected = sellable.find((product) => product.id === Number(productId));
  const parsedQuantity = Number(quantity);
  const isQuantityValid = Number.isInteger(parsedQuantity) && parsedQuantity >= 1;
  const unitPrice = selected && isQuantityValid ? unitPriceFor(selected, parsedQuantity) : null;
  const exceedsStock = selected !== undefined && parsedQuantity > selected.stock.quantity;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSavedMessage(null);
    record.mutate({ productId: Number(productId), quantity: parsedQuantity, notes: notes.trim() || null });
  }

  if (products.isPending) return <Loading />;
  if (products.isError) return <ErrorNotice error={products.error} onRetry={() => products.refetch()} />;
  if (sellable.length === 0) return <EmptyState title={t.sales.nothingInStock} />;

  return (
    <form onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field">
          <span className="field__label">{t.sales.product}</span>
          <select required value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="" disabled>
              {t.sales.chooseProduct}
            </option>
            {sellable.map((product) => (
              <option key={product.id} value={product.id}>
                {t.sales.inStockOption(product.name, product.stock.quantity)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{t.sales.quantity}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            required
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span className="field__label">{t.sales.note}</span>
        <input type="text" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>

      {selected && unitPrice !== null && (
        <p className={exceedsStock ? 'form-error' : 'sale-preview'}>
          {exceedsStock
            ? t.sales.onlyInStock(selected.stock.quantity)
            : `${parsedQuantity} × ${formatMoney(unitPrice)} = ${formatMoney(unitPrice * parsedQuantity)}${unitPrice < selected.price ? t.sales.bulkPrice : ''}`}
        </p>
      )}
      {record.isError && (
        <p className="form-error" role="alert">
          {errorMessage(record.error)}
        </p>
      )}
      {savedMessage && (
        <p className="form-success" role="status">
          {savedMessage}
        </p>
      )}

      <Button type="submit"
       
        disabled={!selected || !isQuantityValid || exceedsStock || record.isPending} variant="primary">
        {record.isPending ? t.sales.recording : t.sales.recordSale}
      </Button>
    </form>
  );
}

function SalesHistory() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const startDate = params.get('from') ?? '';
  const endDate = params.get('to') ?? '';

  const [returningId, setReturningId] = useState<number | null>(null);
  const [returnMessage, setReturnMessage] = useState<string | null>(null);
  const sales = useQuery({
    queryKey: ['sales', { page, startDate, endDate }],
    queryFn: () => salesApi.list({ page, startDate: startDate || undefined, endDate: endDate || undefined }),
    placeholderData: keepPreviousData,
  });

  function updateParams(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  }

  return (
    <Card title={t.sales.history}>
      <div className="toolbar">
        <label className="inline-field">
          {t.sales.from}
          <input type="date" value={startDate} max={endDate || undefined} onChange={(event) => updateParams({ from: event.target.value })} />
        </label>
        <label className="inline-field">
          {t.sales.to}
          <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => updateParams({ to: event.target.value })} />
        </label>
        {sales.data && (
          <span className="toolbar__summary">
            {t.sales.totalFrom({ amount: formatMoney(sales.data.totalRevenue), count: sales.data.meta.total })}
          </span>
        )}
      </div>

      {returnMessage && (
        <p className="form-success" role="status">
          {returnMessage}
        </p>
      )}
      {sales.isPending && <Loading />}
      {sales.isError && <ErrorNotice error={sales.error} onRetry={() => sales.refetch()} />}
      {sales.data && sales.data.items.length === 0 && (
        <EmptyState title={startDate || endDate ? t.sales.noSalesInDates : t.sales.noSalesYet} />
      )}
      {sales.data && sales.data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t.sales.when}</th>
                  <th scope="col">{t.sales.product}</th>
                  <th scope="col" className="table__numeric">
                    {t.sales.qty}
                  </th>
                  <th scope="col" className="table__numeric">
                    {t.sales.each}
                  </th>
                  <th scope="col" className="table__numeric">
                    {t.sales.total}
                  </th>
                  <th scope="col">{t.sales.soldBy}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t.sales.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sales.data.items.map((sale) => (
                  <Fragment key={sale.id}>
                    <tr>
                      <td>{formatDateTime(sale.saleDate)}</td>
                      <td>
                        {sale.productName}
                        {sale.notes && <span className="table__secondary">{sale.notes}</span>}
                        {sale.returnedQuantity > 0 && (
                          <span className="table__secondary">
                            {t.sales.returned(sale.returnedQuantity, sale.quantity)}
                          </span>
                        )}
                      </td>
                      <td className="table__numeric">{sale.quantity}</td>
                      <td className="table__numeric">{formatMoney(sale.pricePerUnit)}</td>
                      <td className="table__numeric">{formatMoney(sale.totalAmount)}</td>
                      <td>{sale.soldBy ?? t.sales.unknown}</td>
                      <td>
                        {sale.returnedQuantity < sale.quantity && (
                          <button
                            type="button"
                            className="text-button"
                            aria-expanded={returningId === sale.id}
                            onClick={() => {
                              setReturnMessage(null);
                              setReturningId(returningId === sale.id ? null : sale.id);
                            }}
                          >
                            {returningId === sale.id ? t.sales.close : t.sales.return}
                          </button>
                        )}
                      </td>
                    </tr>
                    {returningId === sale.id && (
                      <tr className="table__expanded">
                        <td colSpan={7}>
                          <ReturnForm
                            sale={sale}
                            onDone={(message) => {
                              setReturningId(null);
                              setReturnMessage(message);
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={sales.data.meta} itemLabel={t.sales.items} onPageChange={(next) => updateParams({ page: String(next) })} />
        </>
      )}
    </Card>
  );
}
