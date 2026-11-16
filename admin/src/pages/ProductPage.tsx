import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { Link, Navigate, NavLink, Outlet, useParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';
import { productsApi } from '../services/api';
import { formatMoney, formatPromotionDay } from '../utils/format';
import { useFeatures } from '../utils/useFeatures';

/**
 * One page per product: the name and any promotion on top, then two tabs.
 * Stock (the default) is the everyday work: counts, changes and history.
 * Details is what the product is: name, prices, photo and barcode.
 */
export function ProductPage() {
  const t = useT();
  const productId = Number(useParams().id);
  const features = useFeatures();
  // The same query as the Details form, so switching tabs costs nothing.
  const product = useQuery({
    queryKey: ['products', productId],
    queryFn: () => productsApi.get(productId),
  });

  if (product.isPending) return <Loading />;
  if (product.isError) return <ErrorNotice error={product.error} onRetry={() => product.refetch()} />;

  const { name, sku, promotion } = product.data;
  return (
    <>
      <PageHeader
        title={name}
        crumbs={[{ label: t.nav.items.stock, to: '/inventory' }]}
        meta={promotion && <Badge tone="brand">{t.productForm.promotionNow(promotion.percentOff)}</Badge>}
        description={
          (sku || promotion) && (
          <>
            {sku && t.inventory.sku(sku)}
            {sku && promotion && ' · '}
            {promotion && (
              <>
                {t.productForm.onPromotion({
                  name: promotion.name,
                  percent: promotion.percentOff,
                  price: formatMoney(promotion.price),
                  until: formatPromotionDay(promotion.endsAt, true),
                })}{' '}
                <Link to="/promotions" className="text-link">
                  {t.nav.items.promotions}
                </Link>
              </>
            )}
          </>
          )
        }
      />
      <nav className="section-tabs" aria-label={name}>
        <NavLink to={`/products/${productId}`} end className="section-tabs__tab">
          {t.productPage.stock}
        </NavLink>
        <NavLink to={`/products/${productId}/details`} end className="section-tabs__tab">
          {t.productPage.details}
        </NavLink>
        {features.recipes && (
          <NavLink to={`/products/${productId}/made-from`} end className="section-tabs__tab">
            {t.productPage.madeFrom}
          </NavLink>
        )}
        {features.serials && (
          <NavLink to={`/products/${productId}/serials`} end className="section-tabs__tab">
            {t.productPage.serials}
          </NavLink>
        )}
      </nav>
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </>
  );
}

/** The old stock page address, kept working for saved links and alerts. */
export function OldStockPageRedirect() {
  const { productId } = useParams();
  return <Navigate to={`/products/${productId}`} replace />;
}
