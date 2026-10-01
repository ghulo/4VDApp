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

/** Same rule as the backend: the biggest tier the quantity reaches. */
function unitPriceFor(product: Product, quantity: number): number {
  return product.bulkPricingTiers.reduce(
    (price: number, tier: PricingTier) => (quantity >= tier.quantity ? tier.price : price),
    product.price,
  );
}

export function SalesPage() {
  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Sales</h1>
        <p className="page-intro">Recording a sale takes the units out of stock and uses the bulk price automatically.</p>
      </header>
      <section className="panel">
        <h2 className="panel__title">Record a sale</h2>
        <RecordSaleForm />
      </section>
      <SalesHistory />
    </>
  );
}

function RecordSaleForm() {
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
      setSavedMessage(`Sold ${sale.quantity} × ${sale.productName} for ${formatMoney(sale.totalAmount)}.`);
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
  if (sellable.length === 0) return <EmptyState title="Nothing in stock to sell" />;

  return (
    <form onSubmit={handleSubmit}>
      <div className="field-row">
        <label className="field">
          <span className="field__label">Product</span>
          <select required value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="" disabled>
              Choose a product
            </option>
            {sellable.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({product.stock.quantity} in stock)
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Quantity</span>
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
        <span className="field__label">Note (optional)</span>
        <input type="text" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>

      {selected && unitPrice !== null && (
        <p className={exceedsStock ? 'form-error' : 'sale-preview'}>
          {exceedsStock
            ? `Only ${selected.stock.quantity} in stock.`
            : `${parsedQuantity} × ${formatMoney(unitPrice)} = ${formatMoney(unitPrice * parsedQuantity)}${unitPrice < selected.price ? ' (bulk price)' : ''}`}
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

      <button
        type="submit"
        className="button button--primary"
        disabled={!selected || !isQuantityValid || exceedsStock || record.isPending}
      >
        {record.isPending ? 'Recording…' : 'Record sale'}
      </button>
    </form>
  );
}

function SalesHistory() {
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
    <section aria-labelledby="history-heading">
      <h2 id="history-heading" className="panel__title section-title">
        History
      </h2>
      <div className="toolbar">
        <label className="inline-field">
          From
          <input type="date" value={startDate} max={endDate || undefined} onChange={(event) => updateParams({ from: event.target.value })} />
        </label>
        <label className="inline-field">
          To
          <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => updateParams({ to: event.target.value })} />
        </label>
        {sales.data && (
          <span className="toolbar__summary">
            {formatMoney(sales.data.totalRevenue)} from {sales.data.meta.total} {sales.data.meta.total === 1 ? 'sale' : 'sales'}
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
        <EmptyState title={startDate || endDate ? 'No sales in these dates' : 'No sales yet'} />
      )}
      {sales.data && sales.data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Product</th>
                  <th scope="col" className="table__numeric">
                    Qty
                  </th>
                  <th scope="col" className="table__numeric">
                    Each
                  </th>
                  <th scope="col" className="table__numeric">
                    Total
                  </th>
                  <th scope="col">Sold by</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
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
                            {sale.returnedQuantity} of {sale.quantity} returned
                          </span>
                        )}
                      </td>
                      <td className="table__numeric">{sale.quantity}</td>
                      <td className="table__numeric">{formatMoney(sale.pricePerUnit)}</td>
                      <td className="table__numeric">{formatMoney(sale.totalAmount)}</td>
                      <td>{sale.soldBy ?? 'Unknown'}</td>
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
                            {returningId === sale.id ? 'Close' : 'Return'}
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
          <Pagination meta={sales.data.meta} itemLabel="sales" onPageChange={(next) => updateParams({ page: String(next) })} />
        </>
      )}
    </section>
  );
}
