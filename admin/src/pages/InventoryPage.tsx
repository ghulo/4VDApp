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

export function InventoryPage() {
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
        title="Stock"
        description="Emptiest first. &quot;Runs out in&quot; is based on the last 30 days of sales."
      />

      {query.isPending && <Loading />}
      {query.isError && <ErrorNotice error={query.error} onRetry={() => query.refetch()} />}
      {query.data && (
        <DataTable
          caption="Stock"
          rows={query.data.items}
          rowKey={(item) => item.productId}
          columns={[
            {
              header: 'In stock',
              cell: (item) => <StockTag quantity={item.quantity} reorderLevel={item.reorderLevel} />,
            },
            {
              header: 'Product',
              cell: (item) => (
                <>
                  <Link to={`/inventory/${item.productId}`} className="table__primary-link">
                    {item.productName}
                  </Link>
                  {item.sku && <span className="table__secondary">{item.sku}</span>}
                </>
              ),
            },
            { header: 'Reorder at', align: 'end', cell: (item) => item.reorderLevel },
            { header: 'Runs out in', cell: (item) => describeRunway(suggestionById.get(item.productId)) },
            { header: 'Reorder', align: 'end', cell: (item) => suggestionById.get(item.productId)?.suggestedOrder || '–' },
            {
              header: 'Last restocked',
              cell: (item) => (item.lastRestockedAt ? formatDate(item.lastRestockedAt) : 'Never'),
            },
          ]}
          toolbar={
            <>
              <SearchInput
                value={search}
                onChange={(value) => updateParams({ search: value })}
                label="Search by name or SKU"
              />
              <label className="toggle">
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={lowStock}
                  onChange={(event) => updateParams({ lowStock: event.target.checked ? 'true' : null })}
                />
                Only low stock
              </label>
            </>
          }
          empty={
            search || lowStock ? (
              <EmptyState title="No products match">Try a different search or turn off "Only low stock".</EmptyState>
            ) : (
              <EmptyState
                art
                title="No products yet"
                action={
                  <ButtonLink to="/products/new" variant="primary">
                    Add your first product
                  </ButtonLink>
                }
              >
                Stock levels appear here once you add products.
              </EmptyState>
            )
          }
          footer={
            query.data.items.length > 0 && (
              <Pagination
                meta={query.data.meta}
                itemLabel="products"
                onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
              />
            )
          }
        />
      )}
    </>
  );
}

function describeRunway(suggestion: ReorderSuggestion | undefined): string {
  if (!suggestion) return '–';
  if (suggestion.daysLeft === null) return 'No recent sales';
  if (suggestion.daysLeft === 0) return 'Today';
  const trend = suggestion.trend === 'rising' ? ', selling faster' : suggestion.trend === 'falling' ? ', selling slower' : '';
  return `About ${suggestion.daysLeft} ${suggestion.daysLeft === 1 ? 'day' : 'days'}${trend}`;
}
