import { Receipt } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { BasketForm } from '../components/BasketForm';
import { ReturnForm } from '../components/ReturnForm';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { useSalesSeries } from '../components/useSalesSeries';
import { productsApi, reportsApi, salesApi, usersApi } from '../services/api';
import { formatDateWith, formatHeadlineMoney, formatMoney } from '../utils/format';
import type { PeriodKey } from '../utils/periods';
import { usePeriodParams } from '../utils/usePeriodParams';
import { Badge, Button, DataTable, DateField, MetricCard, MetricGrid, PageHeader, Section, Sheet, useNewSheet } from '../components/ui';
import { useCurrentUser } from '../auth/useAuth';
import type { Checkout } from '../services/types';
import { useT } from '../i18n/useT';

const PERIODS: PeriodKey[] = ['today', 'yesterday', 'this-week', 'this-month', 'custom'];

const time = (iso: string) => formatDateWith(new Date(iso), { hour: '2-digit', minute: '2-digit' });
const longDay = (day: string) =>
  formatDateWith(new Date(`${day}T00:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * Sales for a period: how it went (against the period before), then each
 * checkout under its day, opening to show what was bought.
 */
export function SalesPage() {
  const t = useT();
  const user = useCurrentUser();
  const [recording, setRecording] = useNewSheet();
  const period = usePeriodParams('this-month');

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

      <div className="sales-periods">
        <div className="segmented" role="radiogroup" aria-label={t.sales.period}>
          {PERIODS.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={period.period === key}
              className="segmented__option"
              onClick={() => period.changePeriod({ period: key, from: period.from, to: period.to })}
            >
              {key === 'custom' ? t.sales.custom : t.periods.options[key]}
            </button>
          ))}
        </div>
        {period.period === 'custom' && (
          <span className="sales-periods__dates">
            <label className="inline-field">
              {t.sales.from}
              <DateField
                value={period.from}
                max={period.to || undefined}
                onChange={(value) => period.changePeriod({ period: 'custom', from: value, to: period.to })}
              />
            </label>
            <label className="inline-field">
              {t.sales.to}
              <DateField
                value={period.to}
                min={period.from || undefined}
                onChange={(value) => period.changePeriod({ period: 'custom', from: period.from, to: value })}
              />
            </label>
          </span>
        )}
      </div>
      {period.range.waitingForDates && <p className="field-hint">{t.reports.waitingForDates(period.range.label)}</p>}

      <PeriodSummary range={period.comparedRange} />
      <SalesHistory range={period.rangeKey} />

      <Sheet open={recording} onClose={() => setRecording(false)} title={t.sales.record}>
        <BasketForm />
      </Sheet>
    </>
  );
}

function PeriodSummary({ range }: { range: Parameters<typeof reportsApi.summary>[0] }) {
  const t = useT();
  const summary = useQuery({ queryKey: ['reports', 'summary', range], queryFn: () => reportsApi.summary(range), placeholderData: keepPreviousData });
  const series = useSalesSeries(range);
  const points = series.data?.points ?? [];

  if (summary.isPending) return <Loading />;
  if (summary.isError) return <ErrorNotice error={summary.error} onRetry={() => summary.refetch()} />;
  const { current, previous, change } = summary.data;
  const average = (totals: typeof current) => (totals.salesCount > 0 ? totals.revenue / totals.salesCount : 0);
  const averageChange = previous.salesCount > 0 && average(previous) > 0 ? average(current) / average(previous) - 1 : null;

  return (
    <section className="sales-summary" aria-label={t.sales.period} aria-busy={summary.isFetching}>
      <MetricGrid>
        <MetricCard
          label={t.sales.revenue}
          value={formatHeadlineMoney(current.revenue)}
          change={change.revenue}
          series={points.map((point) => point.revenue)}
        />
        <MetricCard label={t.sales.profit} value={formatHeadlineMoney(current.profit)} change={change.profit} series={points.map((point) => point.profit)} />
        <MetricCard label={t.sales.salesCount} value={current.salesCount} change={change.salesCount} series={points.map((point) => point.salesCount)} />
        <MetricCard
          label={t.sales.average}
          value={formatHeadlineMoney(average(current))}
          change={averageChange}
          series={points.map((point) => (point.salesCount > 0 ? point.revenue / point.salesCount : 0))}
        />
      </MetricGrid>
      <p className="field-hint">{t.sales.wholeShop}</p>
    </section>
  );
}

/** "Milk", or "Milk and 2 more" for a checkout with several lines. */
function useDescribe() {
  const t = useT();
  return (checkout: Checkout) => {
    const first = checkout.lines[0];
    if (!first) return '–';
    if (checkout.lines.length > 1) return t.sales.andMore(first.productName, checkout.lines.length - 1);
    return first.quantity > 1 ? `${first.quantity} × ${first.productName}` : first.productName;
  };
}

function ReturnedBadge({ checkout }: { checkout: Checkout }) {
  const t = useT();
  const returned = checkout.lines.reduce((sum, line) => sum + line.returnedQuantity, 0);
  if (returned === 0) return null;
  const all = checkout.lines.every((line) => line.returnedQuantity >= line.quantity);
  return <Badge tone="warn">{all ? t.sales.returnedBadge : t.sales.partReturnedBadge}</Badge>;
}

function SalesHistory({ range }: { range: { startDate: string; endDate: string } }) {
  const describe = useDescribe();
  const t = useT();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const productId = params.get('product') ?? '';
  const soldBy = params.get('seller') ?? '';
  const search = params.get('search') ?? '';
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
    queryKey: ['sales', 'checkouts', { page, ...range, productId, soldBy, search }],
    queryFn: () =>
      salesApi.checkouts({
        page,
        ...range,
        productId: productId ? Number(productId) : undefined,
        soldBy: soldBy ? Number(soldBy) : undefined,
        search: search || undefined,
      }),
    placeholderData: keepPreviousData,
  });
  const dayTotals = new Map((sales.data?.days ?? []).map((day) => [day.day, day]));

  function updateParams(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  }

  function toggle(checkout: Checkout) {
    setReturnMessage(null);
    setReturningId(null);
    setOpenKey(openKey === checkout.key ? null : checkout.key);
  }

  return (
    <Section title={t.sales.history}>
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
          rowClassName={(checkout) => (openKey === checkout.key ? 'table__row--open' : undefined)}
          onRowClick={toggle}
          group={(checkout) => {
            const total = dayTotals.get(checkout.day);
            return {
              key: checkout.day,
              heading: (
                <span className="table__group-line">
                  <span>{longDay(checkout.day)}</span>
                  {total && <span className="table__group-total">{t.sales.dayTotal(total.checkouts, formatMoney(total.revenue))}</span>}
                </span>
              ),
            };
          }}
          toolbar={
            <>
              <SearchInput value={search} onChange={(value) => updateParams({ search: value })} label={t.sales.search} />
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
              <span className="toolbar__summary" aria-live="polite">
                {t.sales.totalFrom({ amount: formatMoney(sales.data.totalRevenue), count: sales.data.meta.total })}
              </span>
            </>
          }
          empty={<EmptyState icon={Receipt} title={t.sales.noSalesInDates} />}
          footer={
            sales.data.items.length > 0 && (
              <Pagination meta={sales.data.meta} itemLabel={t.sales.items} onPageChange={(next) => updateParams({ page: String(next) })} />
            )
          }
          columns={[
            { header: t.sales.when, className: 'table__phone-hide', cell: (checkout) => time(checkout.saleDate) },
            {
              header: t.sales.whatSold,
              title: true,
              cell: (checkout) => (
                <>
                  <span className="sales-what">
                    {/* The whole row opens the sale; this is its keyboard way in. */}
                    <button type="button" className="row-toggle" aria-expanded={openKey === checkout.key} onClick={() => toggle(checkout)}>
                      {describe(checkout)}
                    </button>
                    <ReturnedBadge checkout={checkout} />
                  </span>
                  <span className="table__secondary table__phone-only">
                    {time(checkout.saleDate)} · {checkout.soldBy ?? t.sales.unknown}
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
    </Section>
  );
}
