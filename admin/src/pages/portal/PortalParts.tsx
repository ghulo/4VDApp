import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, type Tone } from '../../components/ui';
import type { Language } from '../../i18n/language';
import { useLanguage, useT } from '../../i18n/useT';
import { type PortalOrderState, portalApi } from '../../services/portalApi';
import { formatMoney } from '../../utils/format';

/** English / Shqip; once signed in the choice is kept on the person, so emails follow it too. */
export function PortalLanguagePick({ signedIn = false }: { signedIn?: boolean }) {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  const options: Array<{ value: Language; label: string }> = [
    { value: 'sq', label: t.language.albanian },
    { value: 'en', label: t.language.english },
  ];
  function choose(next: Language) {
    setLanguage(next);
    if (signedIn) portalApi.setLanguage(next).catch(() => undefined);
  }
  return (
    <div className="segmented segmented--small" role="radiogroup" aria-label={t.portal.language}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={language === option.value} lang={option.value} translate="no" className="segmented__option" onClick={() => choose(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A price with VAT, and under it the same without. */
export function PortalPrice({ gross, net, size = 'md' }: { gross: number; net: number; size?: 'md' | 'lg' }) {
  const t = useT();
  return (
    <span className={`portal-price portal-price--${size}`}>
      <span className="portal-price__gross">{formatMoney(gross)}</span>
      <span className="portal-price__net">
        {formatMoney(net)} {t.portal.vatExcl}
      </span>
    </span>
  );
}

const STATE_TONE: Record<PortalOrderState, Tone> = {
  sent: 'info',
  seen: 'info',
  changed: 'warn',
  offered: 'ok',
  preparing: 'warn',
  on_the_way: 'warn',
  delivered: 'ok',
  done: 'ok',
  declined: 'danger',
  cancelled: 'neutral',
};

export function OrderStateBadge({ state }: { state: PortalOrderState }) {
  const t = useT();
  return <Badge tone={STATE_TONE[state]}>{t.portal.orders.state[state]}</Badge>;
}

// ——— The basket, kept on this phone until it is sent ———

const BASKET_KEY = '4vd.portal.basket';

type Basket = Record<number, number>;

function readBasket(): Basket {
  try {
    const raw = localStorage.getItem(BASKET_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, quantity]) => Number(id) > 0 && typeof quantity === 'number' && quantity > 0)) as Basket;
  } catch {
    return {};
  }
}

function saveBasket(basket: Basket): void {
  try {
    localStorage.setItem(BASKET_KEY, JSON.stringify(basket));
  } catch {
    // Blocked storage: the basket still works until the page is closed.
  }
}

interface BasketValue {
  basket: Basket;
  count: number;
  set: (productId: number, quantity: number) => void;
  replace: (lines: Array<{ productId: number; quantity: number }>) => void;
  clear: () => void;
}

const BasketContext = createContext<BasketValue | null>(null);

export function BasketProvider({ children }: { children: ReactNode }) {
  const [basket, setBasket] = useState<Basket>(readBasket);
  const update = useCallback((next: Basket) => {
    saveBasket(next);
    setBasket(next);
  }, []);
  const set = useCallback(
    (productId: number, quantity: number) => {
      setBasket((current) => {
        const next = { ...current };
        if (quantity > 0) next[productId] = Math.round(quantity * 1000) / 1000;
        else delete next[productId];
        saveBasket(next);
        return next;
      });
    },
    [],
  );
  const replace = useCallback((lines: Array<{ productId: number; quantity: number }>) => update(Object.fromEntries(lines.map((line) => [line.productId, line.quantity]))), [update]);
  const clear = useCallback(() => update({}), [update]);
  const value = useMemo(() => ({ basket, count: Object.keys(basket).length, set, replace, clear }), [basket, set, replace, clear]);
  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

export function useBasket(): BasketValue {
  const value = useContext(BasketContext);
  if (!value) throw new Error('useBasket needs BasketProvider');
  return value;
}

/** The basket priced by the server at today's prices; the phone never works out a price itself. */
export function useQuote() {
  const { basket } = useBasket();
  const lines = Object.entries(basket).map(([productId, quantity]) => ({ productId: Number(productId), quantity }));
  return useQuery({
    queryKey: ['portal', 'quote', lines],
    queryFn: () => portalApi.quote(lines),
    enabled: lines.length > 0,
    placeholderData: (previous) => previous,
  });
}

export const usePortalMe = () => useQuery({ queryKey: ['portal', 'me'], queryFn: portalApi.me, retry: false, staleTime: 60_000 });

/** "14 Nov 2026" from a yyyy-mm-dd day. */
export const dayLabel = (day: string, format: (iso: string) => string) => format(`${day}T12:00:00`);
