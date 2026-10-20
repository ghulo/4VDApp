import { useCallback, useEffect, useRef, useState } from 'react';
import type { RabatApproval } from '../../services/types';

export const MAX_BASKETS = 5;

/** One line as kept between reloads: the product's id, with its name and price as last seen. */
export interface StoredLine {
  productId: number;
  name: string;
  quantity: number;
  /** Rabat in percent, as typed ("7,5"); blank is none (the basket's rabat, if any, applies). */
  discount: string;
  /** The rabat came from typing a new price (F6), so the line says "Price changed". */
  priceSet?: boolean;
}

export interface Basket {
  id: string;
  startedAt: number;
  lines: StoredLine[];
  /** The registered customer buying; none is a walk-in. */
  customerId?: number | null;
  /** Rabat in percent on every line that has none of its own; blank is none. */
  discount?: string;
  /** An owner's yes to a rabat over the limit, for this basket and the person who asked. */
  approval?: RabatApproval;
}

const newBasket = (): Basket => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, startedAt: Date.now(), lines: [] });

function read(key: string): { baskets: Basket[]; current: string } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as { baskets: Basket[]; current: string } | null;
    if (!saved || !Array.isArray(saved.baskets) || saved.baskets.length === 0) return null;
    return { baskets: saved.baskets.slice(0, MAX_BASKETS), current: saved.current };
  } catch {
    return null;
  }
}

/**
 * The baskets open at the Counter, one per waiting customer, up to five. They
 * live in this browser, per person, so a reload or a closed window loses
 * nothing; a basket is gone once it is paid or cancelled.
 */
export function useBaskets(userId: number) {
  const key = `4vd.counter.baskets.${userId}`;
  const [state, setState] = useState(() => {
    const saved = read(key);
    if (saved) return saved;
    const first = newBasket();
    return { baskets: [first], current: first.id };
  });

  // Switch person keeps the till's baskets: they move to the new person (an
  // owner's yes was for the one who asked, so it stays behind).
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current === key) return;
    try {
      localStorage.removeItem(keyRef.current);
    } catch {
      // Nothing saved to move.
    }
    keyRef.current = key;
    setState((now) => ({ ...now, baskets: now.baskets.map(({ approval: _left, ...basket }) => basket) }));
  }, [key]);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Private window or full storage: the baskets still work until the page closes.
    }
  }, [key, state]);

  const current = state.baskets.find((basket) => basket.id === state.current) ?? state.baskets[0]!;

  const setLines = useCallback((update: (lines: StoredLine[]) => StoredLine[]) => {
    setState((now) => ({
      ...now,
      baskets: now.baskets.map((basket) => {
        if (basket.id !== now.current) return basket;
        const lines = update(basket.lines);
        // A sale starts with its first product, not when the empty basket was opened (maybe last night).
        return basket.lines.length === 0 && lines.length > 0 ? { ...basket, lines, startedAt: Date.now() } : { ...basket, lines };
      }),
    }));
  }, []);

  /** Change the basket at the till: its customer or its rabat. */
  const update = useCallback((patch: Partial<Pick<Basket, 'customerId' | 'discount' | 'approval'>>) => {
    setState((now) => ({ ...now, baskets: now.baskets.map((basket) => (basket.id === now.current ? { ...basket, ...patch } : basket)) }));
  }, []);

  /** Park this basket and start another; false when five are open already. */
  const open = useCallback((): boolean => {
    // An empty basket is reused rather than a second one opened.
    const empty = state.baskets.find((basket) => basket.lines.length === 0);
    if (empty) {
      setState((now) => ({ ...now, current: empty.id }));
      return true;
    }
    if (state.baskets.length >= MAX_BASKETS) return false;
    const next = newBasket();
    setState((now) => ({ baskets: [...now.baskets, next], current: next.id }));
    return true;
  }, [state.baskets]);

  const select = useCallback((id: string) => setState((now) => ({ ...now, current: id })), []);

  /** Paid or cancelled: the basket goes, and the next waiting one comes up (or a fresh one). */
  const close = useCallback((id: string) => {
    setState((now) => {
      const rest = now.baskets.filter((basket) => basket.id !== id);
      if (rest.length === 0) {
        const fresh = newBasket();
        return { baskets: [fresh], current: fresh.id };
      }
      return { baskets: rest, current: now.current === id ? rest[0]!.id : now.current };
    });
  }, []);

  return { baskets: state.baskets, current, setLines, update, open, select, close };
}
