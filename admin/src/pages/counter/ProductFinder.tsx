import { type KeyboardEvent, useMemo, useState } from 'react';
import { unitPriceFor } from '../../components/BasketForm';
import { ErrorNotice, Loading } from '../../components/Feedback';
import { Sheet } from '../../components/ui';
import { useT } from '../../i18n/useT';
import type { Product } from '../../services/types';
import { formatMoney } from '../../utils/format';

const SHOWN = 50;

interface FinderProps {
  products: Product[] | undefined;
  error: unknown;
  onRetry: () => void;
  initialQuery: string;
  onAdd: (product: Product) => void;
}

/**
 * Every product, a key press away (F3): type a few letters of the name, the
 * code or the barcode, arrows to choose, Enter to add. It stays open, so
 * several products go in one after the other; Esc goes back to the basket.
 */
export function ProductFinder({ open, onClose, ...form }: FinderProps & { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet open={open} onClose={onClose} title={t.counter.findTitle} description={t.counter.findHint}>
      <FinderForm {...form} />
    </Sheet>
  );
}

function FinderForm({ products, error, onRetry, initialQuery, onAdd }: FinderProps) {
  const t = useT();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [added, setAdded] = useState<string | null>(null);

  const matches = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (products ?? [])
      .filter((product) => {
        const haystack = `${product.name} ${product.sku ?? ''} ${product.barcode ?? ''}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
      .sort((a, b) => Number(b.stock.quantity > 0) - Number(a.stock.quantity > 0) || a.name.localeCompare(b.name));
  }, [products, query]);
  const shown = matches.slice(0, SHOWN);

  function pick(product: Product) {
    if (product.stock.quantity <= 0) return;
    onAdd(product);
    setAdded(t.counter.added(product.name));
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => Math.min(Math.max(index + step, 0), Math.max(shown.length - 1, 0)));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const product = shown[active];
      if (product) pick(product);
    }
  }

  if (!products) return error ? <ErrorNotice error={error} onRetry={onRetry} /> : <Loading />;

  return (
    <div className="counter-form">
      <label className="counter-search">
        <span className="visually-hidden">{t.counter.shelfSearch}</span>
        <input
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls={shown.length > 0 ? 'counter-finder-list' : undefined}
          aria-activedescendant={shown[active] ? `counter-finder-${shown[active].id}` : undefined}
          placeholder={`${t.counter.shelfSearch}…`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setAdded(null);
          }}
          onKeyDown={handleKey}
        />
      </label>
      <p className="counter-hint" aria-live="polite">
        {added ?? t.counter.shelfCount(shown.length, matches.length)}
      </p>
      {shown.length === 0 ? (
        <div className="counter-empty">
          <p className="counter-empty__title">{t.counter.nothingOnShelf}</p>
          <p className="counter-hint">{t.counter.nothingOnShelfHint}</p>
        </div>
      ) : (
        <ul id="counter-finder-list" className="counter-finder" role="listbox" aria-label={t.counter.findTitle}>
          {shown.map((product, index) => {
            const out = product.stock.quantity <= 0;
            const low = !out && product.stock.isLowStock;
            return (
              <li
                key={product.id}
                id={`counter-finder-${product.id}`}
                role="option"
                aria-selected={index === active}
                aria-disabled={out || undefined}
                className={out ? 'counter-finder__item counter-finder__item--out' : 'counter-finder__item'}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(product)}
              >
                <span className="counter-finder__name">{product.name}</span>
                <span className="counter-finder__price">{formatMoney(unitPriceFor(product, 1))}</span>
                <span className="counter-finder__meta">
                  {[product.sku, product.category.name].filter(Boolean).join(' · ')}
                </span>
                <span className={out ? 'counter-finder__stock counter-finder__stock--out' : low ? 'counter-finder__stock counter-finder__stock--low' : 'counter-finder__stock'}>
                  {out ? t.stockTag.out : t.counter.stockLeft(product.stock.quantity)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
