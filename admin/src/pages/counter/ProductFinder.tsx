import { CheckCircle, MagnifyingGlass, X } from '@phosphor-icons/react';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { unitPriceFor } from '../../components/BasketForm';
import { ErrorNotice, Loading } from '../../components/Feedback';
import { Sheet } from '../../components/ui';
import { useT } from '../../i18n/useT';
import type { Product } from '../../services/types';
import { formatMoney } from '../../utils/format';

const SHOWN = 50;
/** How many categories get a chip over the list; the rest are reached by typing. */
const CHIPS = 6;

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
    <Sheet open={open} onClose={onClose} title={t.counter.findTitle} placement="center" wide>
      <FinderForm {...form} />
    </Sheet>
  );
}

/** The typed words picked out in a product's name, so the eye finds why it matched. */
function Marked({ text, words }: { text: string; words: string[] }) {
  if (words.length === 0) return <>{text}</>;
  const lower = text.toLowerCase();
  const hit = new Array<boolean>(text.length).fill(false);
  for (const word of words) {
    for (let from = lower.indexOf(word); from !== -1; from = lower.indexOf(word, from + word.length)) {
      for (let index = from; index < from + word.length; index += 1) hit[index] = true;
    }
  }
  const parts: ReactNode[] = [];
  let start = 0;
  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || hit[index] !== hit[start]) {
      const piece = text.slice(start, index);
      parts.push(hit[start] ? <mark key={start}>{piece}</mark> : piece);
      start = index;
    }
  }
  return <>{parts}</>;
}

function FinderForm({ products, error, onRetry, initialQuery, onAdd }: FinderProps) {
  const t = useT();
  const f = t.counter.finder;
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [added, setAdded] = useState<{ id: number; count: number; name: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const words = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const matches = useMemo(
    () =>
      (products ?? [])
        .filter((product) => {
          const haystack = `${product.name} ${product.sku ?? ''} ${product.barcode ?? ''}`.toLowerCase();
          return words.every((word) => haystack.includes(word));
        })
        .sort((a, b) => Number(b.stock.quantity > 0) - Number(a.stock.quantity > 0) || a.name.localeCompare(b.name)),
    [products, words],
  );
  // The categories the words found most, so a chip narrows "cola" to drinks.
  const chips = useMemo(() => {
    const counts = new Map<number, { id: number; name: string; count: number }>();
    for (const product of matches) {
      const one = counts.get(product.category.id) ?? { ...product.category, count: 0 };
      one.count += 1;
      counts.set(product.category.id, one);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, CHIPS);
  }, [matches]);
  const inCategory = category === null ? matches : matches.filter((product) => product.category.id === category);
  const shown = inCategory.slice(0, SHOWN);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, shown.length]);

  function pick(product: Product) {
    if (product.stock.quantity <= 0) return;
    onAdd(product);
    setAdded((last) => ({ id: product.id, name: product.name, count: last?.id === product.id ? last.count + 1 : 1 }));
    input.current?.focus();
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => Math.min(Math.max(index + step, 0), Math.max(shown.length - 1, 0)));
    }
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      const step = event.key === 'PageDown' ? 8 : -8;
      setActive((index) => Math.min(Math.max(index + step, 0), Math.max(shown.length - 1, 0)));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const product = shown[active];
      if (product) pick(product);
    }
  }

  function changeQuery(next: string) {
    setQuery(next);
    setCategory(null);
    setActive(0);
    setAdded(null);
  }

  if (!products) return error ? <ErrorNotice error={error} onRetry={onRetry} /> : <Loading />;

  return (
    <div className="counter-finder-form">
      <div className="counter-finder-top">
        <label className="counter-search counter-search--big">
          <MagnifyingGlass size={20} weight="bold" aria-hidden="true" />
          <span className="visually-hidden">{t.counter.shelfSearch}</span>
          <input
            ref={input}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={shown.length > 0}
            aria-controls={shown.length > 0 ? 'counter-finder-list' : undefined}
            aria-activedescendant={shown[active] ? `counter-finder-${shown[active].id}` : undefined}
            placeholder={f.placeholder}
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={handleKey}
          />
          {query && (
            <button
              type="button"
              className="counter-search__clear"
              aria-label={f.clear}
              onClick={() => {
                changeQuery('');
                input.current?.focus();
              }}
            >
              <X size={16} weight="bold" aria-hidden="true" />
            </button>
          )}
        </label>
        {chips.length > 1 && (
          <div className="counter-finder-chips" role="group" aria-label={f.categories}>
            <button
              type="button"
              className="counter-finder-chip"
              aria-pressed={category === null}
              onClick={() => {
                setCategory(null);
                setActive(0);
                input.current?.focus();
              }}
            >
              {f.all} <span className="counter-finder-chip__count">{matches.length}</span>
            </button>
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="counter-finder-chip"
                aria-pressed={category === chip.id}
                onClick={() => {
                  setCategory((now) => (now === chip.id ? null : chip.id));
                  setActive(0);
                  input.current?.focus();
                }}
              >
                {chip.name} <span className="counter-finder-chip__count">{chip.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="counter-empty">
          <MagnifyingGlass size={32} aria-hidden="true" className="counter-empty__icon" />
          <p className="counter-empty__title">{t.counter.nothingOnShelf}</p>
          <p className="counter-hint">{t.counter.nothingOnShelfHint}</p>
        </div>
      ) : (
        <ul ref={list} id="counter-finder-list" className="counter-finder" role="listbox" aria-label={t.counter.findTitle}>
          {shown.map((product, index) => {
            const out = product.stock.quantity <= 0;
            const low = !out && product.stock.isLowStock;
            const justAdded = added?.id === product.id;
            return (
              <li
                key={product.id}
                id={`counter-finder-${product.id}`}
                role="option"
                aria-selected={index === active}
                aria-disabled={out || undefined}
                className={out ? 'counter-finder__item counter-finder__item--out' : 'counter-finder__item'}
                onMouseMove={() => index !== active && setActive(index)}
                onClick={() => pick(product)}
              >
                <span className="counter-finder__name">
                  <Marked text={product.name} words={words} />
                </span>
                <span className="counter-finder__meta">
                  {product.sku && <span className="counter-finder__code">{product.sku}</span>}
                  {product.barcode && <span className="counter-finder__code">{product.barcode}</span>}
                  <span>{product.category.name}</span>
                </span>
                <span className="counter-finder__side">
                  <span className="counter-finder__price">
                    {formatMoney(unitPriceFor(product, 1))}
                    {product.unit === 'kg' && <span className="counter-row__unit">/kg</span>}
                  </span>
                  {justAdded ? (
                    <span className="counter-finder__added">
                      <CheckCircle size={14} weight="fill" aria-hidden="true" />
                      {f.addedCount(added.count)}
                    </span>
                  ) : (
                    <span className={out ? 'counter-finder__stock counter-finder__stock--out' : low ? 'counter-finder__stock counter-finder__stock--low' : 'counter-finder__stock'}>
                      {out ? t.stockTag.out : t.counter.stockLeft(product.stock.quantity)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="counter-finder-foot">
        <p className="counter-finder-foot__status" aria-live="polite">
          {added ? t.counter.added(added.name) : t.counter.shelfCount(shown.length, inCategory.length)}
        </p>
        <p className="counter-finder-foot__keys">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {f.choose}
          </span>
          <span>
            <kbd>Enter</kbd> {f.add}
          </span>
          <span>
            <kbd>Esc</kbd> {f.close}
          </span>
        </p>
      </div>
    </div>
  );
}
