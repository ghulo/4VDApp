import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { StockTag } from '../components/StockTag';
import { inventoryApi, reportsApi } from '../services/api';
import type { ReorderSuggestion } from '../services/types';
import { formatDate } from '../utils/format';

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
      <header className="page-header">
        <h1 className="page-title">Stock</h1>
        <p className="page-intro">Emptiest first. &quot;Runs out in&quot; is based on the last 30 days of sales.</p>
      </header>

      <div className="toolbar">
        <SearchInput value={search} onChange={(value) => updateParams({ search: value })} label="Search by name or SKU" />
        <label className="toggle">
          <input
            type="checkbox"
            checked={lowStock}
            onChange={(event) => updateParams({ lowStock: event.target.checked ? 'true' : null })}
          />
          Only low stock
        </label>
      </div>

      {query.isPending && <Loading />}
      {query.isError && <ErrorNotice error={query.error} onRetry={() => query.refetch()} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState title={search || lowStock ? 'No products match' : 'No products yet'}>
          {search || lowStock ? (
            'Try a different search or turn off "Only low stock".'
          ) : (
            <Link to="/products/new" className="button button--primary">
              Add your first product
            </Link>
          )}
        </EmptyState>
      )}
      {query.data && query.data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">In stock</th>
                  <th scope="col">Product</th>
                  <th scope="col" className="table__numeric">
                    Reorder at
                  </th>
                  <th scope="col">Runs out in</th>
                  <th scope="col" className="table__numeric">
                    Reorder
                  </th>
                  <th scope="col">Last restocked</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((item) => (
                  <tr key={item.productId}>
                    <td>
                      <StockTag quantity={item.quantity} reorderLevel={item.reorderLevel} />
                    </td>
                    <td>
                      <Link to={`/inventory/${item.productId}`} className="table__primary-link">
                        {item.productName}
                      </Link>
                      {item.sku && <span className="table__secondary">{item.sku}</span>}
                    </td>
                    <td className="table__numeric">{item.reorderLevel}</td>
                    <td>{describeRunway(suggestionById.get(item.productId))}</td>
                    <td className="table__numeric">{suggestionById.get(item.productId)?.suggestedOrder || '–'}</td>
                    <td>{item.lastRestockedAt ? formatDate(item.lastRestockedAt) : 'Never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            meta={query.data.meta}
            itemLabel="products"
            onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
          />
        </>
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
