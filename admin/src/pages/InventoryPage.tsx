import { Barcode, Package, ShoppingCart, Warning, WarningOctagon, Coins, Hourglass } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { ProductPhoto } from '../components/ProductPhoto';
import { StockTag } from '../components/StockTag';
import { ordersApi, reportsApi } from '../services/api';
import type { ReorderSuggestion } from '../services/types';
import { formatDate, formatHeadlineMoney, formatMoney } from '../utils/format';
import { Badge, ButtonLink, DataTable, EmptyState, PageHeader, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';

const PAGE_SIZE = 20;
/** "Running out soon": a week or less left at the current pace. */
const SOON_DAYS = 7;

const FILTERS = ['all', 'low', 'out', 'soon'] as const;
type Filter = (typeof FILTERS)[number];
const SORTS = ['emptiest', 'soonest', 'name', 'value'] as const;
type Sort = (typeof SORTS)[number];

type Level = 'out' | 'low' | 'ok';
const levelOf = (row: ReorderSuggestion): Level => (row.quantity <= 0 ? 'out' : row.quantity <= row.reorderLevel ? 'low' : 'ok');
const isSoon = (row: ReorderSuggestion) => row.quantity > 0 && row.daysLeft !== null && row.daysLeft <= SOON_DAYS;
const valueOf = (row: ReorderSuggestion) => (row.costPrice === null ? null : Math.max(row.quantity, 0) * row.costPrice);

const matches: Record<Filter, (row: ReorderSuggestion) => boolean> = {
  all: () => true,
  low: (row) => levelOf(row) === 'low',
  out: (row) => levelOf(row) === 'out',
  soon: isSoon,
};

const compare: Record<Sort, (a: ReorderSuggestion, b: ReorderSuggestion) => number> = {
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
  const category = params.get('category') ?? '';

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

  const rows = stock.data ?? [];
  const categories = [...new Map(rows.map((row) => [row.categoryId, row.categoryName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = rows
    .filter(matches[filter])
    .filter((row) => !category || String(row.categoryId) === category)
    .filter((row) => !search || row.productName.toLowerCase().includes(search) || row.sku?.toLowerCase().includes(search))
    .sort(compare[sort]);
  const pageRows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalValue = rows.reduce((sum, row) => sum + (valueOf(row) ?? 0), 0);
  const withoutCost = rows.filter((row) => row.costPrice === null && row.quantity > 0).length;
  const count = (key: Filter) => rows.filter(matches[key]).length;
  const filterLink = (key: Filter) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    if (key === 'all' || key === filter) next.delete('status');
    else next.set('status', key);
    return `/inventory?${next}`;
  };
  const narrowed = filter !== 'all' || category !== '' || search !== '';

  return (
    <>
      <PageHeader
        title={t.nav.items.stock}
        description={t.inventory.description}
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
            <StatGrid>
              <StatTile
                icon={Coins}
                label={t.inventory.stockValue}
                value={formatHeadlineMoney(totalValue)}
                hint={withoutCost > 0 ? t.inventory.withoutCost(withoutCost) : t.inventory.atCost}
                to={filterLink('all')}
              />
              <StatTile icon={Warning} label={t.inventory.lowCount} value={count('low')} tone={count('low') > 0 ? 'warn' : 'default'} to={filterLink('low')} />
              <StatTile
                icon={WarningOctagon}
                label={t.inventory.outCount}
                value={count('out')}
                tone={count('out') > 0 ? 'danger' : 'default'}
                to={filterLink('out')}
              />
              <StatTile icon={Hourglass} label={t.inventory.soonCount} value={count('soon')} tone={count('soon') > 0 ? 'warn' : 'default'} to={filterLink('soon')} />
            </StatGrid>
          )}

          <DataTable
            caption={t.inventory.title}
            rows={pageRows}
            rowKey={(row) => row.productId}
            toolbar={
              <>
                <SearchInput value={params.get('search') ?? ''} onChange={(value) => updateParams({ search: value })} label={t.inventory.search} />
                <div className="segmented segmented--small" role="radiogroup" aria-label={t.inventory.show}>
                  {FILTERS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={filter === key}
                      className="segmented__option"
                      onClick={() => updateParams({ status: key === 'all' ? null : key })}
                    >
                      {t.inventory.filters[key]}
                      {key !== 'all' && <span className="segmented__count">{count(key)}</span>}
                    </button>
                  ))}
                </div>
                <select aria-label={t.inventory.category} value={category} onChange={(event) => updateParams({ category: event.target.value })}>
                  <option value="">{t.inventory.anyCategory}</option>
                  {categories.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <select aria-label={t.inventory.sortBy} value={sort} onChange={(event) => updateParams({ sort: event.target.value === 'emptiest' ? null : event.target.value })}>
                  {SORTS.map((key) => (
                    <option key={key} value={key}>
                      {t.inventory.sorts[key]}
                    </option>
                  ))}
                </select>
              </>
            }
            columns={[
              {
                header: t.inventory.product,
                title: true,
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
                cell: (row) => (
                  <span className="stock-status">
                    <StockTag quantity={row.quantity} reorderLevel={row.reorderLevel} />
                    <LevelBadge level={levelOf(row)} />
                  </span>
                ),
              },
              {
                header: t.inventory.runsOutIn,
                cell: (row) => <span className={runwayClass(row)}>{describeRunway(t, row)}</span>,
              },
              {
                header: t.inventory.value,
                align: 'end',
                className: 'table__phone-hide',
                cell: (row) => {
                  const value = valueOf(row);
                  return value === null ? '–' : formatMoney(value);
                },
              },
              {
                header: t.inventory.reorder,
                align: 'end',
                cell: (row) =>
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

/** Low and out say so in a stamp; fine stock stays quiet (the bar already shows it). */
function LevelBadge({ level }: { level: Level }) {
  const t = useT();
  if (level === 'ok') return null;
  return <Badge tone={level === 'out' ? 'danger' : 'warn'}>{t.stockTag[level]}</Badge>;
}

/** The new-order form on Orders, opened with this product and amount (and its usual supplier). */
function orderLink(row: ReorderSuggestion, supplierId: number | undefined): string {
  const query = new URLSearchParams({ product: String(row.productId), qty: String(row.suggestedOrder) });
  if (supplierId) query.set('supplier', String(supplierId));
  return `/orders/new?${query}`;
}

/** Empty shelves read in red and a week or less of stock in amber; the words still say it. */
function runwayClass(row: ReorderSuggestion): string | undefined {
  if (row.quantity <= 0) return 'runway runway--out';
  if (isSoon(row)) return 'runway runway--soon';
  return undefined;
}

function describeRunway(t: Catalogue, row: ReorderSuggestion): string {
  if (row.quantity <= 0) return t.inventory.soldOutNow;
  if (row.daysLeft === null) return t.inventory.noRecentSales;
  if (row.daysLeft === 0) return t.inventory.today;
  const trend = row.trend === 'rising' ? t.inventory.faster : row.trend === 'falling' ? t.inventory.slower : '';
  return t.inventory.about(row.daysLeft, trend);
}
