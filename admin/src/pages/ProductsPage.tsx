import { Barcode, Package, Plus } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { ProductPhoto } from '../components/ProductPhoto';
import { StockTag } from '../components/StockTag';
import { ButtonLink, DataTable, EmptyState, PageHeader, type Column } from '../components/ui';
import { categoriesApi, productsApi } from '../services/api';
import type { Product } from '../services/types';
import { formatMoney } from '../utils/format';
import { useCurrentUser } from '../auth/useAuth';
import { canManage } from '../auth/roles';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';

const columns = (t: Catalogue): Column<Product>[] => [
  {
    header: t.products.product,
    cell: (product) => (
      <span className="product-cell">
        <ProductPhoto src={product.imageUrl} />
        <span className="product-cell__text">
          <Link to={`/products/${product.id}`} className="table__primary-link">
            {product.name}
          </Link>
          <span className="table__secondary">
            {product.sku ?? t.products.noSku}
            {!product.isActive && t.products.hidden}
          </span>
        </span>
      </span>
    ),
  },
  { header: t.products.category, cell: (product) => product.category.name },
  {
    header: t.products.price,
    align: 'end',
    cell: (product) => (
      <>
        {formatMoney(product.price)}
        {product.promotion && (
          <span className="table__secondary">
            {t.products.promotionNow(product.promotion.percentOff, formatMoney(product.promotion.price))}
          </span>
        )}
      </>
    ),
  },
  {
    header: t.products.bulkPrices,
    align: 'end',
    cell: (product) =>
      product.bulkPricingTiers.length === 0 ? t.products.none : t.products.from(formatMoney(product.bulkPricingTiers.at(-1)!.price)),
  },
  {
    header: t.products.inStock,
    cell: (product) => (
      <Link to={`/inventory/${product.id}`} aria-label={t.products.stockFor(product.name)}>
        <StockTag quantity={product.stock.quantity} reorderLevel={product.stock.reorderLevel} />
      </Link>
    ),
  },
];

export function ProductsPage() {
  const t = useT();
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
        title={t.nav.items.stock}
        description={t.products.description}
        actions={
          <>
            <ButtonLink to="/labels" icon={Barcode}>
              {t.barcodes.printLabel}
            </ButtonLink>
            {canManage(role) && (
              <ButtonLink to="/products/new" variant="primary" icon={Plus}>
                {t.products.add}
              </ButtonLink>
            )}
          </>
        }
      />

      {products.isPending && <Loading />}
      {products.isError && <ErrorNotice error={products.error} onRetry={() => products.refetch()} />}
      {products.data && (
        <DataTable
          caption={t.products.title}
          columns={columns(t)}
          rows={products.data.items}
          rowKey={(product) => product.id}
          rowClassName={(product) => (product.isActive ? undefined : 'table__row--muted')}
          toolbar={
            <>
              <SearchInput
                value={search}
                onChange={(value) => updateParams({ search: value })}
                label={t.products.search}
              />
              <select
                aria-label={t.products.category}
                value={categoryId ?? ''}
                onChange={(event) => updateParams({ categoryId: event.target.value || null })}
              >
                <option value="">{t.products.allCategories}</option>
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
              <EmptyState icon={Package} title={t.products.noMatch}>{t.products.noMatchHint}</EmptyState>
            ) : (
              <EmptyState
                art
                title={t.products.none_yet}
                action={
                  canManage(role) && (
                    <ButtonLink to="/products/new" variant="primary" icon={Plus}>
                      {t.products.addFirst}
                    </ButtonLink>
                  )
                }
              >
                {t.products.emptyHint}
              </EmptyState>
            )
          }
          footer={
            products.data.items.length > 0 && (
              <Pagination
                meta={products.data.meta}
                itemLabel={t.products.items}
                onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
              />
            )
          }
        />
      )}
    </>
  );
}
