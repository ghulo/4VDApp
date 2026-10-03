import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { StockTag } from '../components/StockTag';
import { inventoryApi, reportsApi } from '../services/api';
import type { ReorderSuggestion } from '../services/types';
import { formatDate } from '../utils/format';
import { ButtonLink, DataTable, EmptyState, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';

export function InventoryPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const search = params.get('search') ?? '';
  const lowStock = params.get('lowStock') === 'true';

  const query = useQuery({
    queryKey: ['inventory', { page, search, lowStock }],
    queryFn: () => inventoryApi.list({ page, search, lowStock }),
    placeholderData: keepPreviousData,
  });
  const suggestions = useQuery({ queryKey: ['reports', 'reorder'], queryFn: reportsApi.reorderSuggestions });
  const suggestionById = new Map<number, ReorderSuggestion>(
    (suggestions.data ?? []).map((suggestion) => [suggestion.productId, suggestion]),
  );

  function updateParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // Any filter change starts again from the first page.
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  }

  return (
    <>
      <PageHeader
        title={t.inventory.title}
        description={t.inventory.description}
      />

      {query.isPending && <Loading />}
      {query.isError && <ErrorNotice error={query.error} onRetry={() => query.refetch()} />}
      {query.data && (
        <DataTable
          caption={t.inventory.title}
          rows={query.data.items}
          rowKey={(item) => item.productId}
          columns={[
            {
              header: t.inventory.inStock,
              cell: (item) => <StockTag quantity={item.quantity} reorderLevel={item.reorderLevel} />,
            },
            {
              header: t.inventory.product,
              title: true,
              cell: (item) => (
                <>
                  <Link to={`/inventory/${item.productId}`} className="table__primary-link">
                    {item.productName}
                  </Link>
                  {item.sku && <span className="table__secondary">{item.sku}</span>}
                </>
              ),
            },
            { header: t.inventory.reorderAt, align: 'end', cell: (item) => item.reorderLevel },
            { header: t.inventory.runsOutIn, cell: (item) => describeRunway(t, suggestionById.get(item.productId)) },
            { header: t.inventory.reorder, align: 'end', cell: (item) => suggestionById.get(item.productId)?.suggestedOrder || '–' },
            {
              header: t.inventory.lastRestocked,
              cell: (item) => (item.lastRestockedAt ? formatDate(item.lastRestockedAt) : t.inventory.never),
            },
          ]}
          toolbar={
            <>
              <SearchInput
                value={search}
                onChange={(value) => updateParams({ search: value })}
                label={t.inventory.search}
              />
              <label className="toggle">
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={lowStock}
                  onChange={(event) => updateParams({ lowStock: event.target.checked ? 'true' : null })}
                />
                {t.inventory.onlyLow}
              </label>
            </>
          }
          empty={
            search || lowStock ? (
              <EmptyState title={t.inventory.noMatch}>{t.inventory.noMatchHint}</EmptyState>
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
            query.data.items.length > 0 && (
              <Pagination
                meta={query.data.meta}
                itemLabel={t.inventory.items}
                onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
              />
            )
          }
        />
      )}
    </>
  );
}

function describeRunway(t: Catalogue, suggestion: ReorderSuggestion | undefined): string {
  if (!suggestion) return '–';
  if (suggestion.daysLeft === null) return t.inventory.noRecentSales;
  if (suggestion.daysLeft === 0) return t.inventory.today;
  const trend = suggestion.trend === 'rising' ? t.inventory.faster : suggestion.trend === 'falling' ? t.inventory.slower : '';
  return t.inventory.about(suggestion.daysLeft, trend);
}
