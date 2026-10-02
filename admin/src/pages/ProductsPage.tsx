import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { StockTag } from '../components/StockTag';
import { categoriesApi, productsApi } from '../services/api';
import { formatMoney } from '../utils/format';

export function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const search = params.get('search') ?? '';
  const categoryId = params.get('categoryId') ? Number(params.get('categoryId')) : undefined;

  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const products = useQuery({
    queryKey: ['products', { page, search, categoryId }],
    queryFn: () => productsApi.list({ page, search, categoryId }),
    placeholderData: keepPreviousData,
  });

  function updateParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  }

  const isFiltered = Boolean(search || categoryId);

  return (
    <>
      <header className="page-header page-header--with-action">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="page-intro">Everything in the catalog, including products you've switched off.</p>
        </div>
        <Link to="/products/new" className="button button--primary">
          Add product
        </Link>
      </header>

      <div className="toolbar">
        <SearchInput value={search} onChange={(value) => updateParams({ search: value })} label="Search by name or SKU" />
        <select
          aria-label="Category"
          value={categoryId ?? ''}
          onChange={(event) => updateParams({ categoryId: event.target.value || null })}
        >
          <option value="">All categories</option>
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      {products.isPending && <Loading />}
      {products.isError && <ErrorNotice error={products.error} onRetry={() => products.refetch()} />}
      {products.data && products.data.items.length === 0 && (
        <EmptyState title={isFiltered ? 'No products match' : 'No products yet'}>
          {isFiltered ? (
            'Try a different search or category.'
          ) : (
            <Link to="/products/new" className="button button--primary">
              Add your first product
            </Link>
          )}
        </EmptyState>
      )}
      {products.data && products.data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Category</th>
                  <th scope="col" className="table__numeric">
                    Price
                  </th>
                  <th scope="col" className="table__numeric">
                    Bulk prices
                  </th>
                  <th scope="col">In stock</th>
                </tr>
              </thead>
              <tbody>
                {products.data.items.map((product) => (
                  <tr key={product.id} className={product.isActive ? undefined : 'table__row--muted'}>
                    <td>
                      <Link to={`/products/${product.id}`} className="table__primary-link">
                        {product.name}
                      </Link>
                      <span className="table__secondary">
                        {product.sku ?? 'No SKU'}
                        {!product.isActive && ', hidden from the app'}
                      </span>
                    </td>
                    <td>{product.category.name}</td>
                    <td className="table__numeric">
                      {formatMoney(product.price)}
                      {product.promotion && (
                        <span className="table__secondary">
                          −{product.promotion.percentOff}% now {formatMoney(product.promotion.price)}
                        </span>
                      )}
                    </td>
                    <td className="table__numeric">
                      {product.bulkPricingTiers.length === 0
                        ? 'None'
                        : `From ${formatMoney(product.bulkPricingTiers.at(-1)!.price)}`}
                    </td>
                    <td>
                      <Link to={`/inventory/${product.id}`} aria-label={`Stock for ${product.name}`}>
                        <StockTag quantity={product.stock.quantity} reorderLevel={product.stock.reorderLevel} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            meta={products.data.meta}
            itemLabel="products"
            onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
          />
        </>
      )}
    </>
  );
}
