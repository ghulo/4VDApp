import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarcodeCard } from '../components/BarcodeCard';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { errorMessage } from '../utils/errors';
import { assistantApi, categoriesApi, productsApi } from '../services/api';
import type { Category, PriceChange, Product, ProductInput } from '../services/types';
import { formatDateTime, formatMoney, formatPromotionDay } from '../utils/format';
import { Badge, Button, ButtonLink, Card, PageHeader } from '../components/ui';
import { Package } from '@phosphor-icons/react';
import { ManagersOnly } from '../components/ManagersOnly';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';

/** Form fields are kept as strings so half-typed numbers like "12." don't get mangled. */
interface TierDraft {
  key: number;
  quantity: string;
  price: string;
}

interface ProductDraft {
  name: string;
  description: string;
  categoryId: string;
  price: string;
  costPrice: string;
  sku: string;
  imageUrl: string;
  isActive: boolean;
  stock: string;
  reorderLevel: string;
  tiers: TierDraft[];
}

let nextTierKey = 1;

function toDraft(product?: Product): ProductDraft {
  return {
    name: product?.name ?? '',
    description: product?.description ?? '',
    categoryId: product ? String(product.category.id) : '',
    price: product ? String(product.price) : '',
    costPrice: product?.costPrice != null ? String(product.costPrice) : '',
    sku: product?.sku ?? '',
    imageUrl: product?.imageUrl ?? '',
    isActive: product?.isActive ?? true,
    stock: '0',
    reorderLevel: '10',
    tiers: (product?.bulkPricingTiers ?? []).map((tier) => ({
      key: nextTierKey++,
      quantity: String(tier.quantity),
      price: String(tier.price),
    })),
  };
}

function toInput(draft: ProductDraft, isNew: boolean): ProductInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    categoryId: Number(draft.categoryId),
    price: Number(draft.price),
    costPrice: draft.costPrice === '' ? null : Number(draft.costPrice),
    sku: draft.sku.trim() || null,
    imageUrl: draft.imageUrl.trim() || null,
    isActive: draft.isActive,
    bulkPricingTiers: draft.tiers
      .filter((tier) => tier.quantity !== '' && tier.price !== '')
      .map((tier) => ({ quantity: Number(tier.quantity), price: Number(tier.price) })),
    ...(isNew && { stock: Number(draft.stock || 0), reorderLevel: Number(draft.reorderLevel || 0) }),
  };
}

export function ProductFormPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const productId = Number(id);

  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const product = useQuery({
    queryKey: ['products', productId],
    queryFn: () => productsApi.get(productId),
    enabled: !isNew,
  });

  if (categories.isPending || (!isNew && product.isPending)) return <Loading />;
  if (categories.isError) return <ErrorNotice error={categories.error} onRetry={() => categories.refetch()} />;
  if (!isNew && product.isError) return <ErrorNotice error={product.error} onRetry={() => product.refetch()} />;

  return (
    <ProductForm
      key={product.data?.updatedAt ?? 'new'}
      product={isNew ? undefined : product.data}
      categories={categories.data}
    />
  );
}

function ProductForm({ product, categories }: { product?: Product; categories: Category[] }) {
  const isNew = product === undefined;
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ProductDraft>(() => toDraft(product));
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const update = <TKey extends keyof ProductDraft>(key: TKey, value: ProductDraft[TKey]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: (input: ProductInput) => (isNew ? productsApi.create(input) : productsApi.update(product.id, input)),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      navigate(isNew ? `/products/${saved.id}` : '/products', { replace: isNew });
    },
  });

  const remove = useMutation({
    mutationFn: () => productsApi.remove(product!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      navigate('/products', { replace: true });
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate(toInput(draft, isNew));
  }

  function updateTier(key: number, field: 'quantity' | 'price', value: string) {
    update(
      'tiers',
      draft.tiers.map((tier) => (tier.key === key ? { ...tier, [field]: value } : tier)),
    );
  }

  const price = Number(draft.price);
  const cost = Number(draft.costPrice);
  const margin = draft.price && draft.costPrice && price > 0 ? Math.round(((price - cost) / price) * 100) : null;

  return (
    <>
      <PageHeader
        title={isNew ? t.productForm.addProduct : product.name}
        crumbs={[{ label: t.nav.items.products, to: '/products' }]}
        meta={product?.promotion && <Badge tone="brand">{t.productForm.promotionNow(product.promotion.percentOff)}</Badge>}
        description={
          product?.promotion && (
            <>
              {t.productForm.onPromotion({
                name: product.promotion.name,
                percent: product.promotion.percentOff,
                price: formatMoney(product.promotion.price),
                until: formatPromotionDay(product.promotion.endsAt, true),
              })}{' '}
              <Link to="/promotions" className="text-link">
                {t.nav.items.promotions}
              </Link>
            </>
          )
        }
        actions={
          !isNew && (
            <ButtonLink to={`/inventory/${product.id}`} icon={Package}>
              {t.productForm.stockAndHistory}
            </ButtonLink>
          )
        }
      />

      {categories.length === 0 ? (
        <div className="notice">
          <p>{t.productForm.needCategory}</p>
          <ButtonLink to="/categories" variant="primary">
            {t.productForm.goToCategories}
          </ButtonLink>
        </div>
      ) : (
        <>
        <ManagersOnly note={t.productForm.managersOnly}>
          <form className="product-form" onSubmit={handleSubmit}>
            <Card title={t.productForm.details}>
              <label className="field">
                <span className="field__label">{t.productForm.name}</span>
                <input required maxLength={255} value={draft.name} onChange={(event) => update('name', event.target.value)} />
              </label>
              <div className="field-row">
                <label className="field">
                  <span className="field__label">{t.productForm.category}</span>
                  <select required value={draft.categoryId} onChange={(event) => update('categoryId', event.target.value)}>
                    <option value="" disabled>
                      {t.productForm.chooseCategory}
                    </option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">{t.productForm.sku}</span>
                  <input maxLength={100} value={draft.sku} onChange={(event) => update('sku', event.target.value)} />
                </label>
              </div>
              <label className="field">
                <span className="field__label">{t.productForm.description}</span>
                <textarea
                  rows={3}
                  maxLength={5000}
                  value={draft.description}
                  onChange={(event) => update('description', event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">{t.productForm.image}</span>
                <input
                  type="url"
                  placeholder="https://"
                  value={draft.imageUrl}
                  onChange={(event) => update('imageUrl', event.target.value)}
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) => update('isActive', event.target.checked)}
                />
                {t.productForm.showInApp}
              </label>
            </Card>

            <Card title={t.productForm.price}>
              <div className="field-row">
                <label className="field">
                  <span className="field__label">{t.productForm.pricePerUnit}</span>
                  <input
                    required
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={draft.price}
                    onChange={(event) => update('price', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field__label">{t.productForm.costPrice}</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={draft.costPrice}
                    onChange={(event) => update('costPrice', event.target.value)}
                  />
                </label>
              </div>
              {margin !== null && <p className="field-hint">{t.productForm.margin(margin)}</p>}
              {!isNew && <PriceSuggestionBox productId={product.id} onUse={(price) => update('price', String(price))} />}

              <h3 className="subheading">{t.productForm.bulkPrices}</h3>
              <p className="field-hint">{t.productForm.bulkHint}</p>
              {draft.tiers.length > 0 && (
                <ul className="tier-list">
                  {draft.tiers.map((tier) => (
                    <li key={tier.key} className="tier-list__row">
                      <label className="field">
                        <span className="field__label">{t.productForm.fromQuantity}</span>
                        <input
                          type="number"
                          min={2}
                          step={1}
                          inputMode="numeric"
                          value={tier.quantity}
                          onChange={(event) => updateTier(tier.key, 'quantity', event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">{t.productForm.pricePerUnit}</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          value={tier.price}
                          onChange={(event) => updateTier(tier.key, 'price', event.target.value)}
                        />
                      </label>
                      <Button
                        aria-label={t.productForm.removeTier(tier.quantity || t.productForm.blank)}
                        onClick={() => update('tiers', draft.tiers.filter((other) => other.key !== tier.key))}
                      >
                        {t.productForm.remove}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <Button onClick={() => update('tiers', [...draft.tiers, { key: nextTierKey++, quantity: '', price: '' }])}>
                {t.productForm.addBulk}
              </Button>
            </Card>

            <Card title={t.productForm.stock}>
              {isNew ? (
                <div className="field-row">
                  <label className="field">
                    <span className="field__label">{t.productForm.startingStock}</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={draft.stock}
                      onChange={(event) => update('stock', event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{t.productForm.warnAt}</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={draft.reorderLevel}
                      onChange={(event) => update('reorderLevel', event.target.value)}
                    />
                  </label>
                </div>
              ) : (
                <p className="field-hint">
                  {t.productForm.stockElsewhereBefore(product.stock.quantity)}{' '}
                  <Link to={`/inventory/${product.id}`} className="text-link">
                    {t.productForm.stockPage}
                  </Link>
                  .
                </p>
              )}
            </Card>

            {save.isError && (
              <p className="form-error" role="alert">
                {errorMessage(save.error)}
              </p>
            )}

            <div className="form-actions">
              <Button type="submit" disabled={save.isPending} variant="primary">
                {save.isPending ? t.productForm.saving : isNew ? t.productForm.addProduct : t.productForm.saveChanges}
              </Button>
              <ButtonLink to="/products">
                {t.common.cancel}
              </ButtonLink>
              {!isNew && (
                <span className="form-actions__danger">
                  {confirmingDelete ? (
                    <>
                      <span>{t.productForm.deleteConfirm(product.name)}</span>
                      <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
                        {remove.isPending ? t.productForm.deleting : t.productForm.deleteProduct}
                      </Button>
                      <Button onClick={() => setConfirmingDelete(false)}>
                        {t.productForm.keepIt}
                      </Button>
                    </>
                  ) : (
                    <Button variant="danger-text" onClick={() => setConfirmingDelete(true)}>
                      {t.productForm.deleteProduct}
                    </Button>
                  )}
                </span>
              )}
            </div>
            {remove.isError && (
              <p className="form-error" role="alert">
                {errorMessage(remove.error)}
              </p>
            )}
          </form>
        </ManagersOnly>
        {!isNew && <BarcodeCard product={product} />}
        {!isNew && <PriceHistory productId={product.id} />}
        </>
      )}
    </>
  );
}

/** Asks the AI for a price; "Use this price" only fills the field, the owner still saves. */
function PriceSuggestionBox({ productId, onUse }: { productId: number; onUse: (price: number) => void }) {
  const t = useT();
  const status = useQuery({ queryKey: ['assistant', 'status'], queryFn: assistantApi.status });
  const suggestion = useMutation({ mutationFn: () => assistantApi.suggestPrice(productId) });
  if (!status.data?.enabled) return null;
  const result = suggestion.data;

  return (
    <div className="price-suggestion">
      {!result && (
        <Button disabled={suggestion.isPending} onClick={() => suggestion.mutate()}>
          {suggestion.isPending ? t.productForm.lookingAtSales : t.productForm.suggestPrice}
        </Button>
      )}
      {suggestion.isError && (
        <p className="form-error" role="alert">
          {errorMessage(suggestion.error)}
        </p>
      )}
      {result && (
        <div className="price-suggestion__result callout" aria-live="polite">
          <p className="price-suggestion__headline">
            {t.productForm.decision[result.decision]} {formatMoney(result.suggestedPrice)}
            <span className="price-suggestion__confidence">, {t.productForm.confidence[result.confidence]}</span>
          </p>
          <p>{result.summary}</p>
          <ul className="price-suggestion__reasons">
            {result.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="field-hint">{t.productForm.watchOut(result.watchOut)}</p>
          <div className="price-suggestion__actions">
            {result.decision !== 'keep' && (
              <Button variant="primary" onClick={() => onUse(result.suggestedPrice)}>
                {t.productForm.use(formatMoney(result.suggestedPrice))}
              </Button>
            )}
            <Button disabled={suggestion.isPending} onClick={() => suggestion.mutate()}>
              {suggestion.isPending ? t.productForm.lookingAgain : t.productForm.askAgain}
            </Button>
            <span className="field-hint">{t.productForm.by(result.provider)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const describePriceChange = (t: Catalogue, change: { from: number | null; to: number | null }) =>
  change.from === null
    ? t.productForm.toStart(change.to === null ? t.productForm.none : formatMoney(change.to))
    : `${formatMoney(change.from)} → ${change.to === null ? t.productForm.none : formatMoney(change.to)}`;

/** Every price and cost change, from the activity log. */
function PriceHistory({ productId }: { productId: number }) {
  const t = useT();
  const history = useQuery({
    queryKey: ['products', productId, 'price-history'],
    queryFn: () => productsApi.priceHistory(productId),
  });

  return (
    <Card title={t.productForm.priceHistory} className="product-form">
      {history.isPending && <Loading />}
      {history.isError && <ErrorNotice error={history.error} onRetry={() => history.refetch()} />}
      {history.data && history.data.length === 0 && <p className="field-hint">{t.productForm.noChanges}</p>}
      {history.data && history.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t.productForm.when}</th>
                <th scope="col">{t.productForm.price}</th>
                <th scope="col">{t.productForm.cost}</th>
                <th scope="col">{t.productForm.who}</th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((change: PriceChange) => (
                <tr key={change.changedAt}>
                  <td>{formatDateTime(change.changedAt)}</td>
                  <td>{change.price ? describePriceChange(t, change.price) : '–'}</td>
                  <td>{change.costPrice ? describePriceChange(t, change.costPrice) : '–'}</td>
                  <td>{change.changedBy ?? t.productForm.removedUser}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
