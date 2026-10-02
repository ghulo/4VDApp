import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { errorMessage } from '../utils/errors';
import { assistantApi, categoriesApi, productsApi } from '../services/api';
import type { Category, PriceChange, Product, ProductInput } from '../services/types';
import { formatDateTime, formatMoney, formatPromotionDay } from '../utils/format';

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
      <header className="page-header">
        <Link to="/products" className="back-link">
          Products
        </Link>
        <h1 className="page-title">{isNew ? 'Add product' : product.name}</h1>
        {product?.promotion && (
          <p className="page-intro">
            On promotion: {product.promotion.name}, −{product.promotion.percentOff}% ({formatMoney(product.promotion.price)})
            until {formatPromotionDay(product.promotion.endsAt, true)}.{' '}
            <Link to="/promotions" className="text-link">
              Promotions
            </Link>
          </p>
        )}
      </header>

      {categories.length === 0 ? (
        <div className="notice">
          <p>Products need a category. Create one first.</p>
          <Link to="/categories" className="button button--primary">
            Go to categories
          </Link>
        </div>
      ) : (
        <>
        <form className="product-form" onSubmit={handleSubmit}>
          <section className="panel">
            <h2 className="panel__title">Details</h2>
            <label className="field">
              <span className="field__label">Name</span>
              <input required maxLength={255} value={draft.name} onChange={(event) => update('name', event.target.value)} />
            </label>
            <div className="field-row">
              <label className="field">
                <span className="field__label">Category</span>
                <select required value={draft.categoryId} onChange={(event) => update('categoryId', event.target.value)}>
                  <option value="" disabled>
                    Choose a category
                  </option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">SKU (optional)</span>
                <input maxLength={100} value={draft.sku} onChange={(event) => update('sku', event.target.value)} />
              </label>
            </div>
            <label className="field">
              <span className="field__label">Description (optional)</span>
              <textarea
                rows={3}
                maxLength={5000}
                value={draft.description}
                onChange={(event) => update('description', event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Image link (optional)</span>
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
              Show in the mobile app
            </label>
          </section>

          <section className="panel">
            <h2 className="panel__title">Price</h2>
            <div className="field-row">
              <label className="field">
                <span className="field__label">Price per unit (€)</span>
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
                <span className="field__label">What it costs you (€, optional)</span>
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
            {margin !== null && <p className="field-hint">Margin {margin}%. Only admins can see what it costs you.</p>}
            {!isNew && <PriceSuggestionBox productId={product.id} onUse={(price) => update('price', String(price))} />}

            <h3 className="subheading">Bulk prices</h3>
            <p className="field-hint">
              Cheaper per unit for bigger orders. Each tier must cost less than the one before it.
            </p>
            {draft.tiers.length > 0 && (
              <ul className="tier-list">
                {draft.tiers.map((tier) => (
                  <li key={tier.key} className="tier-list__row">
                    <label className="field">
                      <span className="field__label">From quantity</span>
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
                      <span className="field__label">Price per unit (€)</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        value={tier.price}
                        onChange={(event) => updateTier(tier.key, 'price', event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="button button--quiet"
                      aria-label={`Remove tier from ${tier.quantity || 'blank'} units`}
                      onClick={() => update('tiers', draft.tiers.filter((other) => other.key !== tier.key))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="button button--quiet"
              onClick={() => update('tiers', [...draft.tiers, { key: nextTierKey++, quantity: '', price: '' }])}
            >
              Add bulk price
            </button>
          </section>

          <section className="panel">
            <h2 className="panel__title">Stock</h2>
            {isNew ? (
              <div className="field-row">
                <label className="field">
                  <span className="field__label">Starting stock</span>
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
                  <span className="field__label">Warn me when stock reaches</span>
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
                {product.stock.quantity} in stock. Stock changes are logged, so they're made on the{' '}
                <Link to={`/inventory/${product.id}`} className="text-link">
                  stock page
                </Link>
                .
              </p>
            )}
          </section>

          {save.isError && (
            <p className="form-error" role="alert">
              {errorMessage(save.error)}
            </p>
          )}

          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : isNew ? 'Add product' : 'Save changes'}
            </button>
            <Link to="/products" className="button button--quiet">
              Cancel
            </Link>
            {!isNew && (
              <span className="form-actions__danger">
                {confirmingDelete ? (
                  <>
                    <span>Delete {product.name}? Sales history is kept.</span>
                    <button type="button" className="button button--danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
                      {remove.isPending ? 'Deleting…' : 'Delete product'}
                    </button>
                    <button type="button" className="button button--quiet" onClick={() => setConfirmingDelete(false)}>
                      Keep it
                    </button>
                  </>
                ) : (
                  <button type="button" className="button button--quiet button--danger-text" onClick={() => setConfirmingDelete(true)}>
                    Delete product
                  </button>
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
        {!isNew && <PriceHistory productId={product.id} />}
        </>
      )}
    </>
  );
}

const DECISION_TEXT = { raise: 'Raise to', lower: 'Lower to', keep: 'Keep at' } as const;

/** Asks the AI for a price; "Use this price" only fills the field, the owner still saves. */
function PriceSuggestionBox({ productId, onUse }: { productId: number; onUse: (price: number) => void }) {
  const status = useQuery({ queryKey: ['assistant', 'status'], queryFn: assistantApi.status });
  const suggestion = useMutation({ mutationFn: () => assistantApi.suggestPrice(productId) });
  if (!status.data?.enabled) return null;
  const result = suggestion.data;

  return (
    <div className="price-suggestion">
      {!result && (
        <button type="button" className="button button--quiet" disabled={suggestion.isPending} onClick={() => suggestion.mutate()}>
          {suggestion.isPending ? 'Looking at sales…' : 'Suggest a price'}
        </button>
      )}
      {suggestion.isError && (
        <p className="form-error" role="alert">
          {errorMessage(suggestion.error)}
        </p>
      )}
      {result && (
        <div className="price-suggestion__result" aria-live="polite">
          <p className="price-suggestion__headline">
            {DECISION_TEXT[result.decision]} {formatMoney(result.suggestedPrice)}
            <span className="price-suggestion__confidence">, {result.confidence} confidence</span>
          </p>
          <p>{result.summary}</p>
          <ul className="price-suggestion__reasons">
            {result.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="field-hint">Watch out: {result.watchOut}</p>
          <div className="price-suggestion__actions">
            {result.decision !== 'keep' && (
              <button type="button" className="button button--primary" onClick={() => onUse(result.suggestedPrice)}>
                Use {formatMoney(result.suggestedPrice)}
              </button>
            )}
            <button type="button" className="button button--quiet" disabled={suggestion.isPending} onClick={() => suggestion.mutate()}>
              {suggestion.isPending ? 'Looking again…' : 'Ask again'}
            </button>
            <span className="field-hint">By {result.provider}. Nothing changes until you save.</span>
          </div>
        </div>
      )}
    </div>
  );
}

const describePriceChange = (change: { from: number | null; to: number | null }) =>
  change.from === null
    ? `${change.to === null ? 'none' : formatMoney(change.to)} to start`
    : `${formatMoney(change.from)} → ${change.to === null ? 'none' : formatMoney(change.to)}`;

/** Every price and cost change, from the activity log. */
function PriceHistory({ productId }: { productId: number }) {
  const history = useQuery({
    queryKey: ['products', productId, 'price-history'],
    queryFn: () => productsApi.priceHistory(productId),
  });

  return (
    <section className="panel product-form" aria-labelledby="price-history-heading">
      <h2 id="price-history-heading" className="panel__title">
        Price history
      </h2>
      {history.isPending && <Loading />}
      {history.isError && <ErrorNotice error={history.error} onRetry={() => history.refetch()} />}
      {history.data && history.data.length === 0 && <p className="field-hint">No price changes recorded yet.</p>}
      {history.data && history.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Price</th>
                <th scope="col">Cost</th>
                <th scope="col">Who</th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((change: PriceChange) => (
                <tr key={change.changedAt}>
                  <td>{formatDateTime(change.changedAt)}</td>
                  <td>{change.price ? describePriceChange(change.price) : '–'}</td>
                  <td>{change.costPrice ? describePriceChange(change.costPrice) : '–'}</td>
                  <td>{change.changedBy ?? 'Removed user'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
