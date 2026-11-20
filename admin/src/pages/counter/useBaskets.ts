import type { ShortDatedPick } from '../../utils/shortDated';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeliveryInput, PayLaterApproval, RabatApproval } from '../../services/types';
import type { Payment } from './CounterSheets';
import type { QueuedSale } from './offlineQueue';

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
  /** Sold at the price an offer gave the customer; the rabat keys leave it alone. */
  offerPrice?: number;
  /** Stickered short-dated units the cashier tapped: this many of the line sell at the batch's price. */
  shortDated?: ShortDatedPick;
  /** Serial numbers typed for this line's units (products that have them), first ones first. */
  serials?: string[];
}

/** One press of Record sale, as it went to the server. */
export interface PendingSale {
  key: string;
  payment: Payment;
  body: QueuedSale['body'];
  /** The total the Counter showed. */
  total: number;
  /** When Record sale was pressed (ISO). */
  at: string;
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
  /** The offer this basket sells (each line at its offered price), and its number. */
  offerId?: number | null;
  offerNumber?: string | null;
  /** "Deliver it": where and when, and whether the rest is collected at the door. */
  delivery?: DeliveryInput | null;
  /** An owner's yes to this customer paying later, for this basket. */
  payLater?: PayLaterApproval | null;
  /** Wholesale prices switched on or off for this basket; left out: what the customer pays. */
  wholesale?: boolean | null;
  /**
   * A sale sent to the server whose answer hasn't come (yet): written to this
   * PC before it is sent, so Pay pressed again (an answer lost, a reload)
   * sends exactly the same sale with the same key, and the server records it
   * once. The basket can't change while it is here.
   */
  pending?: PendingSale;
}

export type BasketState = { baskets: Basket[]; current: string };
type State = BasketState;
type Patch = Partial<Pick<Basket, 'customerId' | 'discount' | 'approval' | 'offerId' | 'offerNumber' | 'delivery' | 'payLater' | 'wholesale'>>;

// What each change does to the baskets, kept apart from React so it can be tested.

/** New lines in the basket at the till; one whose sale is on its way stays exactly as it was sent. */
export function changeLines(now: State, update: (lines: StoredLine[]) => StoredLine[], at = Date.now()): State {
  return {
    ...now,
    baskets: now.baskets.map((basket) => {
      if (basket.id !== now.current || basket.pending) return basket;
      const lines = update(basket.lines);
      // A sale starts with its first product, not when the empty basket was opened (maybe last night).
      return basket.lines.length === 0 && lines.length > 0 ? { ...basket, lines, startedAt: at } : { ...basket, lines };
    }),
  };
}

/** The customer, rabat, delivery… of the basket at the till; not while its sale is on its way. */
export function changeBasket(now: State, patch: Patch): State {
  return { ...now, baskets: now.baskets.map((basket) => (basket.id !== now.current || basket.pending ? basket : { ...basket, ...patch })) };
}

/** The sale on its way for a basket, or none once the server said no to it. */
export function withPending(now: State, id: string, pending: PendingSale | null): State {
  return {
    ...now,
    baskets: now.baskets.map((basket) => {
      if (basket.id !== id) return basket;
      const { pending: _was, ...rest } = basket;
      return pending ? { ...rest, pending } : rest;
    }),
  };
}

/** Paid or cancelled: the basket goes (its sale on its way with it), and the next waiting one comes up, or a fresh one. */
export function withoutBasket(now: State, id: string, fresh: () => Basket = newBasket): State {
  const rest = now.baskets.filter((basket) => basket.id !== id);
  if (rest.length === 0) {
    const first = fresh();
    return { baskets: [first], current: first.id };
  }
  return { baskets: rest, current: now.current === id ? rest[0]!.id : now.current };
}

const newBasket = (): Basket => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, startedAt: Date.now(), lines: [] });

function read(key: string): State | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as State | null;
    if (!saved || !Array.isArray(saved.baskets) || saved.baskets.length === 0) return null;
    return { baskets: saved.baskets.slice(0, MAX_BASKETS), current: saved.current };
  } catch {
    return null;
  }
}

function write(key: string, state: State) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Private window or full storage: the baskets still work until the page closes.
  }
}

const keyOf = (userId: number) => `4vd.counter.baskets.${userId}`;

/** A basket on this PC with something in it, for this person. */
export const basketsWaiting = (userId: number): boolean => read(keyOf(userId))?.baskets.some((basket) => basket.lines.length > 0) ?? false;

/**
 * The baskets open at the Counter, one per waiting customer, up to five. They
 * live in this browser, per person, so a reload or a closed window loses
 * nothing; a basket is gone once it is paid or cancelled.
 */
export function useBaskets(userId: number) {
  const key = keyOf(userId);
  const [state, setState] = useState<State>(() => {
    const saved = read(key);
    if (saved) return saved;
    const first = newBasket();
    return { baskets: [first], current: first.id };
  });
  const keyRef = useRef(key);
  // Every change is written to this PC at once (not after the next paint), so a sale about to be sent is on disk first.
  const latest = useRef(state);
  const apply = useCallback((change: (now: State) => State) => {
    const next = change(latest.current);
    if (next === latest.current) return;
    latest.current = next;
    write(keyRef.current, next);
    setState(next);
  }, []);

  // Switch person keeps the till's baskets: they move to the new person (an
  // owner's yes was for the one who asked, so it stays behind).
  useEffect(() => {
    if (keyRef.current === key) return;
    try {
      localStorage.removeItem(keyRef.current);
    } catch {
      // Nothing saved to move.
    }
    keyRef.current = key;
    apply((now) => ({ ...now, baskets: now.baskets.map(({ approval: _left, ...basket }) => basket) }));
  }, [key, apply]);

  const current = state.baskets.find((basket) => basket.id === state.current) ?? state.baskets[0]!;

  const setLines = useCallback((update: (lines: StoredLine[]) => StoredLine[]) => apply((now) => changeLines(now, update)), [apply]);

  /** Change the basket at the till: its customer or its rabat. */
  const update = useCallback((patch: Patch) => apply((now) => changeBasket(now, patch)), [apply]);

  /** The sale about to be sent for this basket (on disk before it goes), or null once the server said no to it. */
  const setPending = useCallback((id: string, pending: PendingSale | null) => apply((now) => withPending(now, id, pending)), [apply]);

  /** Park this basket and start another; false when five are open already. */
  const open = useCallback((): boolean => {
    const now = latest.current;
    // An empty basket is reused rather than a second one opened.
    const empty = now.baskets.find((basket) => basket.lines.length === 0);
    if (empty) {
      apply((was) => ({ ...was, current: empty.id }));
      return true;
    }
    if (now.baskets.length >= MAX_BASKETS) return false;
    const next = newBasket();
    apply((was) => ({ baskets: [...was.baskets, next], current: next.id }));
    return true;
  }, [apply]);

  const select = useCallback((id: string) => apply((now) => (now.current === id ? now : { ...now, current: id })), [apply]);

  /** Paid or cancelled: the basket goes, and the next waiting one comes up (or a fresh one). */
  const close = useCallback((id: string) => apply((now) => withoutBasket(now, id)), [apply]);

  return { baskets: state.baskets, current, setLines, update, setPending, open, select, close };
}
