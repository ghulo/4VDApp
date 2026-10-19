import { CaretRight, Package, Star } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { staffLayout } from '../../auth/roles';
import { useCurrentUser } from '../../auth/useAuth';
import { CameraScanButton } from '../../components/CameraScanner';
import { ExpiryCard } from '../../components/ExpiryCard';
import { ErrorNotice, Loading } from '../../components/Feedback';
import { Pagination } from '../../components/Pagination';
import { ProductPhoto } from '../../components/ProductPhoto';
import { SearchInput } from '../../components/SearchInput';
import { StockTag } from '../../components/StockTag';
import { WriteOffForm } from '../../components/WriteOffForm';
import { Button, ButtonLink, Card, EmptyState, PageHeader } from '../../components/ui';
import { useT } from '../../i18n/useT';
import { categoriesApi, productsApi } from '../../services/api';
import type { Product } from '../../services/types';
import { FAVORITES_KEY, teamApi } from '../../services/teamApi';
import { errorMessage } from '../../utils/errors';
import { formatMoney } from '../../utils/format';

type Pick = 'writeOff' | 'expiry';
const PICKS: Pick[] = ['writeOff', 'expiry'];
const PAGE_SIZE = 30;

/** Favourites as a set of ids, shared by the list and each product page. */
function useFavoriteIds() {
  return useQuery({ queryKey: [...FAVORITES_KEY, 'ids'], queryFn: teamApi.favoriteIds });
}

/**
 * Products for the counter staff (the team app's Products tab): search by
 * name or barcode, scan with the camera, a category or the favourites. From
 * Home's "Damage or loss" and "Expiry date" it asks which product first.
 */
export function StaffProductsPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const then = PICKS.find((pick) => pick === params.get('then')) ?? null;
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<number | 'favourites' | null>(null);
  const [page, setPage] = useState(1);
  const [scanProblem, setScanProblem] = useState<string | null>(null);

  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list, staleTime: 5 * 60_000 });
  const favorites = useQuery({ queryKey: FAVORITES_KEY, queryFn: teamApi.favorites, enabled: category === 'favourites' });
  const products = useQuery({
    queryKey: ['products', 'staff', search, category, page],
    queryFn: () =>
      productsApi.list({ page, limit: PAGE_SIZE, search: search.trim() || undefined, categoryId: typeof category === 'number' ? category : undefined }),
    enabled: category !== 'favourites',
    placeholderData: keepPreviousData,
  });

  const open = (product: Product) => navigate(`/catalog/${product.id}${then ? `?open=${then}` : ''}`);
  async function scanned(code: string) {
    setScanProblem(null);
    try {
      open(await productsApi.byBarcode(code));
    } catch {
      setScanProblem(t.staff.camera.notFound(code));
    }
  }

  const query = search.trim().toLowerCase();
  const rows =
    category === 'favourites'
      ? (favorites.data ?? []).filter((product) => !query || product.name.toLowerCase().includes(query) || product.barcode === search.trim())
      : (products.data?.items ?? []);
  const loading = category === 'favourites' ? favorites.isPending : products.isPending;
  const failed = category === 'favourites' ? favorites.error : products.error;

  return (
    <>
      <PageHeader title={then ? t.staff.products.pickFor[then] : t.staff.products.title} actions={<CameraScanButton onScan={scanned} />} />
      <div className="staff-page">
        {then && (
          <p className="staff-pick">
            <span>{t.staff.products.pickFor[then]}</span>
            <Button size="sm" variant="ghost" onClick={() => setParams({})}>
              {t.staff.products.cancelPick}
            </Button>
          </p>
        )}
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          label={t.staff.products.search}
        />
        {scanProblem && (
          <p className="form-error" role="alert">
            {scanProblem}
          </p>
        )}
        <div className="chip-row" role="radiogroup" aria-label={t.staff.products.title}>
          <Chip active={category === null} onClick={() => (setCategory(null), setPage(1))}>
            {t.staff.products.all}
          </Chip>
          <Chip active={category === 'favourites'} onClick={() => (setCategory('favourites'), setPage(1))}>
            <Star size={14} weight={category === 'favourites' ? 'fill' : 'regular'} aria-hidden="true" /> {t.staff.products.favourites}
          </Chip>
          {(categories.data ?? []).map((entry) => (
            <Chip key={entry.id} active={category === entry.id} onClick={() => (setCategory(entry.id), setPage(1))}>
              {entry.name}
            </Chip>
          ))}
        </div>

        {loading && <Loading />}
        {failed && <ErrorNotice error={failed} onRetry={() => (category === 'favourites' ? favorites.refetch() : products.refetch())} />}
        {!loading && !failed && rows.length === 0 &&
          (category === 'favourites' && !query ? (
            <EmptyState icon={Star} title={t.staff.products.noFavourites}>
              {t.staff.products.noFavouritesHint}
            </EmptyState>
          ) : (
            <EmptyState icon={Package} title={t.staff.products.nothingMatches}>
              {t.staff.products.tryAnother}
            </EmptyState>
          ))}
        {rows.length > 0 && (
          <ul className="staff-rows">
            {rows.map((product) => (
              <li key={product.id}>
                <Link to={`/catalog/${product.id}${then ? `?open=${then}` : ''}`} className="staff-row">
                  <ProductPhoto src={product.imageUrl} />
                  <span className="staff-row__text staff-row__grow">
                    <span className="staff-row__title staff-row__clip">{product.name}</span>
                    <span className="staff-row__hint">{formatMoney(product.promotion?.price ?? product.price)}</span>
                  </span>
                  <StockTag quantity={product.stock.quantity} reorderLevel={product.stock.reorderLevel} />
                  <CaretRight size={18} aria-hidden="true" className="staff-row__caret" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {category !== 'favourites' && products.data && products.data.meta.total > products.data.meta.limit && <Pagination meta={products.data.meta} itemLabel={t.products.items} onPageChange={setPage} />}
      </div>
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" className="chip" aria-checked={active} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * One product as the counter sees it (no costs): photo, price, stock, a
 * favourite star, Sell it, expiry dates and reporting damage or loss.
 */
export function StaffProductPage() {
  const t = useT();
  const { id } = useParams();
  const [params] = useSearchParams();
  const productId = Number(id);
  const opened = params.get('open');
  const queryClient = useQueryClient();
  const product = useQuery({ queryKey: ['products', productId], queryFn: () => productsApi.get(productId), enabled: Number.isInteger(productId) });
  const favoriteIds = useFavoriteIds();
  const isFavorite = favoriteIds.data?.includes(productId) ?? false;
  const toggle = useMutation({
    mutationFn: () => (isFavorite ? teamApi.removeFavorite(productId) : teamApi.addFavorite(productId)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: FAVORITES_KEY }),
  });

  // From Home's "Damage or loss" or "Expiry date": bring that form into view once the product is in.
  const loaded = product.isSuccess;
  useEffect(() => {
    if (!loaded || (opened !== 'writeOff' && opened !== 'expiry')) return;
    document.getElementById(opened === 'writeOff' ? 'write-off' : 'expiry')?.scrollIntoView({ block: 'start' });
  }, [loaded, opened]);

  if (product.isPending) return <Loading />;
  if (product.isError) return <ErrorNotice error={product.error} onRetry={() => product.refetch()} />;
  const item = product.data;
  const price = item.promotion?.price ?? item.price;

  return (
    <>
      <PageHeader
        title={item.name}
        crumbs={[{ label: t.staff.products.title, to: '/catalog' }]}
        actions={
          <Button
            variant="ghost"
            icon={Star}
            aria-pressed={isFavorite}
            loading={toggle.isPending}
            onClick={() => toggle.mutate()}
          >
            {isFavorite ? t.staff.products.removeFavourite : t.staff.products.addFavourite}
          </Button>
        }
      />
      <div className="staff-page">
        {toggle.isError && (
          <p className="form-error" role="alert">
            {errorMessage(toggle.error)}
          </p>
        )}
        <Card>
          <div className="staff-product">
            <ProductPhoto src={item.imageUrl} size="lg" />
            <div className="staff-product__facts">
              <p className="staff-figure">{formatMoney(price)}</p>
              {item.promotion && <p className="staff-muted">{item.promotion.name}</p>}
              <StockTag quantity={item.stock.quantity} reorderLevel={item.stock.reorderLevel} size="large" />
              <p className="staff-muted">{[item.category.name, item.barcode].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          <ButtonLink to={`/counter?add=${item.id}`} variant="primary">
            {t.staff.products.sell}
          </ButtonLink>
        </Card>

        <div id="expiry" className={opened === 'expiry' ? 'staff-focus' : undefined}>
          <ExpiryCard productId={item.id} />
        </div>

        <Card title={t.staff.products.writeOffTitle} id="write-off" className={opened === 'writeOff' ? 'staff-focus' : undefined}>
          <WriteOffForm productId={item.id} inStock={item.stock.quantity} />
        </Card>
      </div>
    </>
  );
}

/**
 * A product's QR code holds a link like /scan/<barcode>, so any phone camera
 * opens it: find the product and go to its page (the staff's or the full one).
 */
export function ScanLinkPage() {
  const t = useT();
  const { code = '' } = useParams();
  const { role } = useCurrentUser();
  const product = useQuery({ queryKey: ['products', 'barcode', code], queryFn: () => productsApi.byBarcode(code), retry: false });
  if (product.isPending) return <Loading />;
  if (product.isError) {
    return (
      <EmptyState icon={Package} title={t.staff.camera.notFound(code)} action={<ButtonLink to="/">{t.staff.newProduct.home}</ButtonLink>} />
    );
  }
  return <Navigate to={staffLayout(role) ? `/catalog/${product.data.id}` : `/products/${product.data.id}`} replace />;
}
