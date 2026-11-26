import { ArrowsLeftRight, Barcode, Package, ShoppingCart, Warning, WarningOctagon, Coins, Hourglass } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { canManage, canOversee } from '../auth/roles';
import { useLocations } from '../utils/useLocations';
import { useCurrentUser } from '../auth/useAuth';
import { ExportMenu } from '../components/ExportMenu';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { ProductPhoto } from '../components/ProductPhoto';
import { StockTag } from '../components/StockTag';
import { ordersApi, reportsApi } from '../services/api';
import type { ReorderSuggestion } from '../services/types';
import { formatDate, formatHeadlineMoney, formatMoney } from '../utils/format';
import { Badge, ButtonLink, DataTable, EmptyState, MultiSelect, PageHeader, StatGrid, StatTile } from '../components/ui';
import type { SortDirection, TableSort } from '../components/ui/DataTable';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';

const PAGE_SIZE = 50;
/** "Running out soon": a week or less left at the current pace. */
const SOON_DAYS = 7;

const FILTERS = ['all', 'low', 'out', 'soon', 'refill'] as const;
type Filter = (typeof FILTERS)[number];
const SORTS = ['emptiest', 'soonest', 'name', 'value'] as const;
type Sort = (typeof SORTS)[number];
/** The column each order sorts by (Product, In stock, Runs out in, Value) and which way it runs first. */
const SORT_COLUMN: Record<Sort, { column: number; direction: SortDirection }> = {
  name: { column: 0, direction: 'asc' },
  emptiest: { column: 1, direction: 'asc' },
  soonest: { column: 2, direction: 'asc' },
  value: { column: 3, direction: 'desc' },
};

/** A product as the list shows it: with a location picked, `quantity` is what that location holds and `total` the whole shop's. */
type Row = ReorderSuggestion & { total: number };

type Level = 'out' | 'low' | 'ok';
// Low and out are about the whole shop ("order more"), whichever location is shown.
const levelOf = (row: Row): Level => (row.total <= 0 ? 'out' : row.total <= row.reorderLevel ? 'low' : 'ok');
const isSoon = (row: Row) => row.total > 0 && row.daysLeft !== null && row.daysLeft <= SOON_DAYS;
const valueOf = (row: ReorderSuggestion) => (row.costPrice === null ? null : Math.max(row.quantity, 0) * row.costPrice);

const matches: Record<Filter, (row: Row) => boolean> = {
  all: () => true,
  low: (row) => levelOf(row) === 'low',
  out: (row) => levelOf(row) === 'out',
  soon: isSoon,
  refill: (row) => row.refill > 0,
};

const compare: Record<Sort, (a: Row, b: Row) => number> = {
  // Furthest below its reorder level first, so problems are on top.
  emptiest: (a, b) => a.quantity - a.reorderLevel - (b.quantity - b.reorderLevel) || a.productName.localeCompare(b.productName),
  soonest: (a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.productName.localeCompare(b.productName),
  name: (a, b) => a.productName.localeCompare(b.productName),
  value: (a, b) => (valueOf(b) ?? -1) - (valueOf(a) ?? -1) || a.productName.localeCompare(b.productName),
};

/**
 * Everything on the shelf (DESIGN.md 3.5): what the stock is worth and what
 * needs attention, as tiles that filter the list; then each product with its
 * level, how long it lasts and, when it's time, a button to order more.
 * A family shop has a few hundred products at most, so the whole list loads
 * once and filters, sorts and pages here.
 */
export function InventoryPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const search = (params.get('search') ?? '').trim().toLowerCase();
  const filter: Filter = FILTERS.find((key) => key === params.get('status')) ?? 'all';
  const sort: Sort = SORTS.find((key) => key === params.get('sort')) ?? 'emptiest';
  // ?order=rev turns the order round (a second click on the same column heading).
  const reversed = params.get('order') === 'rev';
  const tableSort: TableSort = {
    column: SORT_COLUMN[sort].column,
    direction: reversed ? (SORT_COLUMN[sort].direction === 'asc' ? 'desc' : 'asc') : SORT_COLUMN[sort].direction,
  };
  const pickSort = (next: TableSort | null) => {
    const key = next ? SORTS.find((one) => SORT_COLUMN[one].column === next.column) : undefined;
    if (!next || !key) return updateParams({ sort: null, order: null });
    updateParams({ sort: key === 'emptiest' ? null : key, order: next.direction === SORT_COLUMN[key].direction ? null : 'rev' });
  };
  // One or more categories, as ?category=3,7 (a single id from an older link still works).
  const chosenCategories = (params.get('category') ?? '').split(',').filter(Boolean);
  const { several, locations } = useLocations();
  // With one location there is nothing to pick, and no refilling from storage.
  const place = several ? (locations.find((location) => String(location.id) === params.get('location'))?.id ?? null) : null;
  const filters = FILTERS.filter((key) => key !== 'refill' || several);

  const stock = useQuery({ queryKey: ['reports', 'reorder'], queryFn: reportsApi.reorderSuggestions });
  // Who usually supplies each product, so Order opens with that supplier picked.
  const usual = useQuery({ queryKey: ['orders', 'usual-suppliers'], queryFn: ordersApi.usualSuppliers, enabled: canManage(role) });

  function updateParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // Any filter change starts again from the first page.
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  }

  const all: Row[] = (stock.data ?? []).map((row) => ({ ...row, total: row.quantity }));
  const rows: Row[] =
    place === null
      ? all
      : all.flatMap((row) => {
          const here = row.places.find((one) => one.locationId === place);
          return here ? [{ ...row, quantity: here.quantity }] : [];
        });
  const categories = [...new Map(rows.map((row) => [row.categoryId, row.categoryName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = rows
    .filter(matches[filter])
    .filter((row) => chosenCategories.length === 0 || chosenCategories.includes(String(row.categoryId)))
    .filter((row) => !search || row.productName.toLowerCase().includes(search) || row.sku?.toLowerCase().includes(search))
    .sort(reversed ? (a, b) => compare[sort](b, a) : compare[sort]);
  const pageRows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalValue = rows.reduce((sum, row) => sum + (valueOf(row) ?? 0), 0);
  const shownValue = shown.reduce((sum, row) => sum + (valueOf(row) ?? 0), 0);
  const withoutCost = rows.filter((row) => row.costPrice === null && row.quantity > 0).length;
  const count = (key: Filter) => rows.filter(matches[key]).length;
  const filterLink = (key: Filter) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    if (key === 'all' || key === filter) next.delete('status');
    else next.set('status', key);
    return `/inventory?${next}`;
  };
  const narrowed = filter !== 'all' || chosenCategories.length > 0 || search !== '' || place !== null;

  return (
    <>
      <PageHeader
        title={t.nav.items.stock}
       
        actions={
          <ButtonLink to="/labels" icon={Barcode}>
            {t.barcodes.printLabel}
          </ButtonLink>
        }
      />

      {stock.isPending && <Loading />}
      {stock.isError && <ErrorNotice error={stock.error} onRetry={() => stock.refetch()} />}
      {stock.data && (
        <>
          {rows.length > 0 && (
            <StatGrid compact>
              <StatTile
                icon={Coins}
                label={t.inventory.stockValue}
                value={formatHeadlineMoney(totalValue)}
                hint={withoutCost > 0 ? t.inventory.withoutCost(withoutCost) : t.inventory.atCost}
                to={filterLink('all')}
              />
              <StatTile icon={Warning} label={t.inventory.lowCount} value={count('low')} words={count('low') === 0 && t.inventory.noneLow} tone={count('low') > 0 ? 'warn' : 'default'} to={filterLink('low')} />
              <StatTile
                icon={WarningOctagon}
                label={t.inventory.outCount}
                value={count('out')}
                words={count('out') === 0 && t.inventory.noneOut}
                tone={count('out') > 0 ? 'danger' : 'default'}
                to={filterLink('out')}
              />
              {several && count('refill') > 0 && (
                <StatTile icon={ArrowsLeftRight} label={t.locations.refill} value={count('refill')} tone="warn" to={filterLink('refill')} />
              )}
              <StatTile icon={Hourglass} label={t.inventory.soonCount} value={count('soon')} words={count('soon') === 0 && t.inventory.noneSoon} tone={count('soon') > 0 ? 'warn' : 'default'} to={filterLink('soon')} />
            </StatGrid>
          )}

          <DataTable
            caption={t.inventory.title}
            rows={pageRows}
            rowKey={(row) => row.productId}
            sort={tableSort}
            onSortChange={pickSort}
            toolbar={
              <div className="toolbar">
                <SearchInput value={params.get('search') ?? ''} onChange={(value) => updateParams({ search: value })} label={t.inventory.search} />
                <div className="segmented segmented--small segmented--chips" role="radiogroup" aria-label={t.inventory.show}>
                  {filters.map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={filter === key}
                      className="segmented__option"
                      onClick={() => updateParams({ status: key === 'all' ? null : key })}
                    >
                      {key === 'refill' ? t.locations.refill : t.inventory.filters[key]}
                      {key !== 'all' && count(key) > 0 && <span className="segmented__count">{count(key)}</span>}
                    </button>
                  ))}
                </div>
                {several && (
                  <select aria-label={t.locations.filter} value={place ?? ''} onChange={(event) => updateParams({ location: event.target.value })}>
                    <option value="">{t.locations.all}</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                )}
                <MultiSelect
                  label={t.inventory.category}
                  anyLabel={t.inventory.anyCategory}
                  options={categories.map(([id, name]) => ({ value: String(id), label: name ?? '' }))}
                  values={chosenCategories}
                  onChange={(next) => updateParams({ category: next.join(',') })}
                />
                <select aria-label={t.inventory.sortBy} value={sort} onChange={(event) => updateParams({ sort: event.target.value === 'emptiest' ? null : event.target.value, order: null })}>
                  {SORTS.map((key) => (
                    <option key={key} value={key}>
                      {t.inventory.sorts[key]}
                    </option>
                  ))}
                </select>
                <div className="toolbar__end">
                  <ExportMenu kind="stock" />
                </div>
              </div>
            }
            columns={[
              {
                header: t.inventory.product,
                title: true,
                sortValue: (row) => row.productName,
                cell: (row) => (
                  <span className="product-cell">
                    <ProductPhoto src={row.imageUrl} />
                    <span className="product-cell__text">
                      <Link to={`/products/${row.productId}`} className="table__primary-link">
                        {row.productName}
                      </Link>
                      <span className="table__secondary">{[row.sku, row.categoryName].filter(Boolean).join(' · ')}</span>
                    </span>
                  </span>
                ),
              },
              {
                header: t.inventory.inStock,
                sortValue: (row) => row.quantity - row.reorderLevel,
                cell: (row) => (
                  <span className="stock-status">
                    <StockTag quantity={row.quantity} reorderLevel={row.reorderLevel} />
                    <LevelBadge level={levelOf(row)} />
                  </span>
                ),
              },
              {
                header: t.inventory.runsOutIn,
                sortValue: (row) => row.daysLeft,
                cell: (row) => <Runway row={row} />,
              },
              {
                header: t.inventory.value,
                align: 'end',
                sortValue: valueOf,
                sortFirst: 'desc',
                cell: (row) => {
                  const value = valueOf(row);
                  return value === null ? '–' : formatMoney(value);
                },
              },
              // Shown only while something on the selling floor is under its shelf minimum and storage has it.
              ...(several && canOversee(role) && rows.some((row) => row.refill > 0)
                ? [
                  {
                    header: t.locations.refill,
                    align: 'end' as const,
                    cell: (row: Row) =>
                      row.refill > 0 ? (
                        <ButtonLink size="sm" icon={ArrowsLeftRight} to={`/stock-moves?new=1&product=${row.productId}&qty=${row.refill}`} aria-label={t.locations.bringLabel(row.refill, row.productName)}>
                          {t.locations.bring(row.refill)}
                        </ButtonLink>
                      ) : (
                        '–'
                      ),
                  },
                  ]
                : []),
              // A column of dashes says nothing: it shows only when something needs ordering.
              ...(rows.some((row) => row.suggestedOrder > 0)
                ? [
                  {
                    header: t.inventory.reorder,
                    align: 'end' as const,
                    cell: (row: Row) =>
                      row.suggestedOrder > 0 ? (
                        canManage(role) ? (
                          <ButtonLink
                            size="sm"
                            icon={ShoppingCart}
                            to={orderLink(row, usual.data?.[row.productId])}
                            aria-label={t.inventory.orderLabel(row.suggestedOrder, row.productName)}
                          >
                            {`${t.inventory.order} ${row.suggestedOrder}`}
                          </ButtonLink>
                        ) : (
                          row.suggestedOrder
                        )
                      ) : (
                        '–'
                      ),
                  },
                  ]
                : []),
              {
                header: t.inventory.lastRestocked,
                className: 'table__phone-hide',
                cell: (row) => (row.lastRestockedAt ? formatDate(row.lastRestockedAt) : t.inventory.never),
              },
            ]}
            empty={
              narrowed ? (
                <EmptyState
                  icon={Package}
                  title={t.inventory.noMatch}
                  action={
                    <ButtonLink to="/inventory" variant="secondary">
                      {t.inventory.showAll}
                    </ButtonLink>
                  }
                >
                  {t.inventory.noMatchHint}
                </EmptyState>
              ) : (
                <EmptyState
                  art
                  title={t.inventory.noneYet}
                  action={
                    <ButtonLink to="/products/new" variant="primary">
                      {t.inventory.addFirst}
                    </ButtonLink>
                  }
                >
                  {t.inventory.emptyHint}
                </EmptyState>
              )
            }
            totals={[t.inventory.totalOf(shown.length), '', '', formatMoney(shownValue), '', '']}
            footer={
              shown.length > 0 && (
                <Pagination
                  meta={{ page, limit: PAGE_SIZE, total: shown.length }}
                  itemLabel={t.inventory.items}
                  onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
                />
              )
            }
          />
        </>
      )}
    </>
  );
}

/** Only out of stock gets a stamp: low is already the number and the bar (the filter says Low). */
function LevelBadge({ level }: { level: Level }) {
  const t = useT();
  if (level !== 'out') return null;
  return <Badge tone="danger">{t.stockTag.out}</Badge>;
}

/** The new-order form on Orders, opened with this product and amount (and its usual supplier). */
function orderLink(row: ReorderSuggestion, supplierId: number | undefined): string {
  const query = new URLSearchParams({ product: String(row.productId), qty: String(row.suggestedOrder) });
  if (supplierId) query.set('supplier', String(supplierId));
  return `/orders/new?${query}`;
}

/** Empty shelves read in red and a week or less of stock in amber; the words still say it. */
function runwayClass(row: Row): string | undefined {
  if (row.total <= 0) return 'runway runway--out';
  if (isSoon(row)) return 'runway runway--soon';
  return undefined;
}

/** The server's forecast stops at a year (forecast.ts MAX_FORECAST_DAYS). */
const YEAR_OR_MORE = 365;

/** How long the stock lasts, kept to one line: "189 days ↓", with the full sentence on hover and for screen readers. */
function Runway({ row }: { row: Row }) {
  const t = useT();
  const sentence = describeRunway(t, row);
  if (row.total <= 0 || row.daysLeft === null || row.daysLeft === 0) return <span className={runwayClass(row)}>{sentence}</span>;
  // The forecast stops counting at a year, so 365 means "longer": say that, not a number that looks exact.
  if (row.daysLeft >= YEAR_OR_MORE) {
    return (
      <span className={runwayClass(row)} title={sentence}>
        {t.inventory.overYear}
      </span>
    );
  }
  const arrow = row.trend === 'rising' ? '↑' : row.trend === 'falling' ? '↓' : null;
  return (
    <span className={runwayClass(row)} title={sentence}>
      <span aria-hidden="true">
        {t.inventory.daysLeft(row.daysLeft)}
        {arrow && <span className="runway__trend">{arrow}</span>}
      </span>
      <span className="visually-hidden">{sentence}</span>
    </span>
  );
}

function describeRunway(t: Catalogue, row: Row): string {
  if (row.total <= 0) return t.inventory.soldOutNow;
  if (row.daysLeft === null) return t.inventory.noRecentSales;
  if (row.daysLeft === 0) return t.inventory.today;
  if (row.daysLeft >= YEAR_OR_MORE) return t.inventory.overYearLong;
  const trend = row.trend === 'rising' ? t.inventory.faster : row.trend === 'falling' ? t.inventory.slower : '';
  return t.inventory.about(row.daysLeft, trend);
}
