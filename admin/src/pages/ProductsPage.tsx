import { Plus } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { StockTag } from '../components/StockTag';
import { ButtonLink, DataTable, EmptyState, PageHeader, type Column } from '../components/ui';
import { categoriesApi, productsApi } from '../services/api';
import type { Product } from '../services/types';
import { formatMoney } from '../utils/format';
import { useCurrentUser } from '../auth/useAuth';
import { canManage } from '../auth/roles';

const COLUMNS: Column<Product>[] = [
  {
    header: 'Product',
    cell: (product) => (
      <>
        <Link to={`/products/${product.id}`} className="table__primary-link">
          {product.name}
        </Link>
        <span className="table__secondary">
          {product.sku ?? 'No SKU'}
          {!product.isActive && ', hidden from the app'}
        </span>
      </>
    ),
  },
  { header: 'Category', cell: (product) => product.category.name },
  {
    header: 'Price',
    align: 'end',
    cell: (product) => (
      <>
        {formatMoney(product.price)}
        {product.promotion && (
          <span className="table__secondary">
            −{product.promotion.percentOff}% now {formatMoney(product.promotion.price)}
          </span>
        )}
      </>
    ),
  },
  {
    header: 'Bulk prices',
    align: 'end',
    cell: (product) =>
      product.bulkPricingTiers.length === 0 ? 'None' : `From ${formatMoney(product.bulkPricingTiers.at(-1)!.price)}`,
  },
  {
    header: 'In stock',
    cell: (product) => (
      <Link to={`/inventory/${product.id}`} aria-label={`Stock for ${product.name}`}>
        <StockTag quantity={product.stock.quantity} reorderLevel={product.stock.reorderLevel} />
      </Link>
    ),
  },
];

export function ProductsPage() {
  const { role } = useCurrentUser();
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
      <PageHeader
        title="Products"
        description="Everything in the catalog, including products you've switched off."
        actions={
          canManage(role) && (
            <ButtonLink to="/products/new" variant="primary" icon={Plus}>
              Add product
            </ButtonLink>
          )
        }
      />

      {products.isPending && <Loading />}
      {products.isError && <ErrorNotice error={products.error} onRetry={() => products.refetch()} />}
      {products.data && (
        <DataTable
          caption="Products"
          columns={COLUMNS}
          rows={products.data.items}
          rowKey={(product) => product.id}
          rowClassName={(product) => (product.isActive ? undefined : 'table__row--muted')}
          toolbar={
            <>
              <SearchInput
                value={search}
                onChange={(value) => updateParams({ search: value })}
                label="Search by name or SKU"
              />
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
            </>
          }
          empty={
            isFiltered ? (
              <EmptyState title="No products match">Try a different search or category.</EmptyState>
            ) : (
              <EmptyState
                art
                title="No products yet"
                action={
                  canManage(role) && (
                    <ButtonLink to="/products/new" variant="primary" icon={Plus}>
                      Add your first product
                    </ButtonLink>
                  )
                }
              >
                Add what you sell, with its price and how many you have.
              </EmptyState>
            )
          }
          footer={
            products.data.items.length > 0 && (
              <Pagination
                meta={products.data.meta}
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
