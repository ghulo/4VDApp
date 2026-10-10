import { Receipt } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { BasketForm } from '../components/BasketForm';
import { ReturnForm } from '../components/ReturnForm';
import { Pagination } from '../components/Pagination';
import { productsApi, salesApi, usersApi } from '../services/api';
import { formatDateTime, formatMoney } from '../utils/format';
import { Button, Card, DataTable, PageHeader, Sheet, useNewSheet } from '../components/ui';
import { useCurrentUser } from '../auth/useAuth';
import type { Checkout } from '../services/types';
import { useT } from '../i18n/useT';

export function SalesPage() {
  const t = useT();
  const user = useCurrentUser();
  const [recording, setRecording] = useNewSheet();
  return (
    <>
      <PageHeader
        title={t.nav.items.sales}
        description={t.sales.description}
        actions={
          user.role !== 'owner' && (
            <Button variant="primary" icon={Receipt} onClick={() => setRecording(true)}>
              {t.sales.record}
            </Button>
          )
        }
      />
      <SalesHistory />
      <Sheet open={recording} onClose={() => setRecording(false)} title={t.sales.record}>
        <BasketForm />
      </Sheet>
    </>
  );
}

/** "Milk", or "Milk and 2 more" for a checkout with several lines. */
function useDescribe() {
  const t = useT();
  return (checkout: Checkout) =>
    checkout.lines.length > 1 ? t.sales.andMore(checkout.lines[0]!.productName, checkout.lines.length - 1) : (checkout.lines[0]?.productName ?? '–');
}

function SalesHistory() {
  const describe = useDescribe();
  const t = useT();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const startDate = params.get('from') ?? '';
  const endDate = params.get('to') ?? '';
  const productId = params.get('product') ?? '';
  const soldBy = params.get('seller') ?? '';
  // Every product, sold out or not, and everyone who has ever sold: history keeps them all.
  const products = useQuery({
    queryKey: ['products', { page: 1, limit: 100, purpose: 'filter' }],
    queryFn: () => productsApi.list({ page: 1, limit: 100 }),
  });
  const people = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list(1) });

  // The checkout that is open to show its lines, and the line being returned.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [returningId, setReturningId] = useState<number | null>(null);
  const [returnMessage, setReturnMessage] = useState<string | null>(null);
  const sales = useQuery({
    queryKey: ['sales', 'checkouts', { page, startDate, endDate, productId, soldBy }],
    queryFn: () =>
      salesApi.checkouts({
        page,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        productId: productId ? Number(productId) : undefined,
        soldBy: soldBy ? Number(soldBy) : undefined,
      }),
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

  const filtered = Boolean(startDate || endDate || productId || soldBy);

  return (
    <Card title={t.sales.history} flush>
      {returnMessage && (
        <p className="form-success" role="status">
          {returnMessage}
        </p>
      )}
      {sales.isPending && <Loading />}
      {sales.isError && <ErrorNotice error={sales.error} onRetry={() => sales.refetch()} />}
      {sales.data && (
        <DataTable
          caption={t.sales.history}
          rows={sales.data.items}
          rowKey={(checkout) => checkout.key}
          toolbar={
            <>
              <label className="inline-field">
                {t.sales.from}
                <input type="date" value={startDate} max={endDate || undefined} onChange={(event) => updateParams({ from: event.target.value })} />
              </label>
              <label className="inline-field">
                {t.sales.to}
                <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => updateParams({ to: event.target.value })} />
              </label>
              <select aria-label={t.sales.product} value={productId} onChange={(event) => updateParams({ product: event.target.value })}>
                <option value="">{t.sales.anyProduct}</option>
                {products.data?.items.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
              <select aria-label={t.sales.soldBy} value={soldBy} onChange={(event) => updateParams({ seller: event.target.value })}>
                <option value="">{t.sales.anyone}</option>
                {people.data?.items.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              <span className="toolbar__summary">
                {t.sales.totalFrom({ amount: formatMoney(sales.data.totalRevenue), count: sales.data.meta.total })}
              </span>
            </>
          }
          empty={<EmptyState icon={Receipt} title={filtered ? t.sales.noSalesInDates : t.sales.noSalesYet} />}
          footer={
            sales.data.items.length > 0 && (
              <Pagination meta={sales.data.meta} itemLabel={t.sales.items} onPageChange={(next) => updateParams({ page: String(next) })} />
            )
          }
          columns={[
            { header: t.sales.when, className: 'table__phone-hide', cell: (checkout) => formatDateTime(checkout.saleDate) },
            {
              header: t.sales.whatSold,
              title: true,
              cell: (checkout) => (
                <>
                  {describe(checkout)}
                  <span className="table__secondary table__phone-only">
                    {formatDateTime(checkout.saleDate)} · {checkout.soldBy ?? t.sales.unknown}
                  </span>
                </>
              ),
            },
            { header: t.sales.total, align: 'end', cell: (checkout) => formatMoney(checkout.total) },
            { header: t.sales.soldBy, className: 'table__phone-hide', cell: (checkout) => checkout.soldBy ?? t.sales.unknown },
            {
              header: t.documents.invoice,
              cell: (checkout) => (checkout.invoice ? <Link to={`/documents/${checkout.invoice.id}`}>{checkout.invoice.number}</Link> : '–'),
            },
            {
              header: <span className="visually-hidden">{t.sales.actions}</span>,
              cell: (checkout) => (
                <button
                  type="button"
                  className="text-button"
                  aria-expanded={openKey === checkout.key}
                  aria-label={openKey === checkout.key ? undefined : t.sales.openLabel(describe(checkout))}
                  onClick={() => {
                    setReturnMessage(null);
                    setReturningId(null);
                    setOpenKey(openKey === checkout.key ? null : checkout.key);
                  }}
                >
                  {openKey === checkout.key ? t.sales.close : t.sales.open}
                </button>
              ),
            },
          ]}
          afterRow={(checkout) =>
            openKey === checkout.key && (
              <tr className="table__expanded">
                <td colSpan={6}>
                  <DataTable
                    caption={t.sales.lines}
                    rows={checkout.lines}
                    rowKey={(sale) => sale.id}
                    columns={[
                      {
                        header: t.sales.product,
                        title: true,
                        cell: (sale) => (
                          <>
                            {sale.productName}
                            {sale.notes && <span className="table__secondary">{sale.notes}</span>}
                            {sale.returnedQuantity > 0 && (
                              <span className="table__secondary">{t.sales.returned(sale.returnedQuantity, sale.quantity)}</span>
                            )}
                          </>
                        ),
                      },
                      { header: t.sales.qty, align: 'end', cell: (sale) => sale.quantity },
                      { header: t.sales.each, align: 'end', cell: (sale) => formatMoney(sale.pricePerUnit) },
                      { header: t.sales.total, align: 'end', cell: (sale) => formatMoney(sale.totalAmount) },
                      {
                        header: <span className="visually-hidden">{t.sales.actions}</span>,
                        cell: (sale) =>
                          sale.returnedQuantity < sale.quantity && (
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
                          ),
                      },
                    ]}
                    afterRow={(sale) =>
                      returningId === sale.id && (
                        <tr className="table__expanded">
                          <td colSpan={5}>
                            <ReturnForm
                              sale={sale}
                              onDone={(message) => {
                                setReturningId(null);
                                setReturnMessage(message);
                              }}
                            />
                          </td>
                        </tr>
                      )
                    }
                  />
                </td>
              </tr>
            )
          }
        />
      )}
    </Card>
  );
}
