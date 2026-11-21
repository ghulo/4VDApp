/*
 * Sales this till sent from its waiting queue that 4VD took, kept off the
 * till's shelf until it has a shelf that counts them. A queued sale is never
 * taken off the shelf by hand (patched): it stays held, first in the queue,
 * then here, until 4VD's shelf names it (or was asked for after 4VD took it).
 * So a lost answer, a replay that says "recorded already" or a stalled shelf
 * fetch never shows a sold unit again, nor takes one off twice. Kept in this
 * PC's storage, like the queue, so a reload keeps the hold too.
 */

import type { Hold, TillShelf } from './shelfAfterSale';
import { counts } from './shelfAfterSale';
import { COPY_MAX_AGE_MS } from '../../offline/savedCopy';

const STORAGE_KEY = '4vd.counter.sent';
/**
 * A hold is let go once the shelf saved on this PC counts it. Kept longer than a saved shelf may be used (a day past it):
 * a hold that old can't be needed, because any saved shelf that doesn't count it is too old to sell from.
 */
const KEEP_MS = COPY_MAX_AGE_MS + 24 * 3600_000;

export interface SentHold extends Hold {
  businessId: number;
  ackedAt: number;
}

export interface SentStore {
  read(): SentHold[];
  /** False when this PC's storage refused it. */
  write(holds: SentHold[]): boolean;
}

export const localSentStore: SentStore = {
  read() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
      return Array.isArray(saved) ? (saved as SentHold[]) : [];
    } catch {
      return [];
    }
  },
  write(holds) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(holds));
      return true;
    } catch {
      return false;
    }
  },
};

/** 4VD took this waiting sale: keep it off the shelf until a shelf counts it. False when it couldn't be written (the sale then stays in the queue). */
export function keepSent(store: SentStore, hold: SentHold, now = Date.now()): boolean {
  const others = store.read().filter((one) => one.key !== hold.key && now - one.ackedAt < KEEP_MS);
  return store.write([...others, { key: hold.key, businessId: hold.businessId, items: hold.items.map(({ productId, quantity }) => ({ productId, quantity })), ackedAt: hold.ackedAt }]);
}

/**
 * What this business's sales held on this PC took off the shelf: the queued ones and the sent ones, one hold per sale.
 * A crash between keeping a sent hold and taking the sale out of the queue leaves both, and it must not count twice.
 */
export function holdsFor(queued: ReadonlyArray<Hold & { businessId?: number }>, sent: readonly SentHold[], businessId: number): Hold[] {
  const mine = queued.filter((sale) => sale.businessId === businessId).map(({ key, items }) => ({ key, items }));
  const inQueue = new Set(mine.map((hold) => hold.key.toLowerCase()));
  return [...mine, ...sent.filter((hold) => hold.businessId === businessId && !inQueue.has(hold.key.toLowerCase()))];
}

/** This business's shelf is saved on this PC now: the holds it counts go (and very old ones). Only ever with the saved shelf, never one only in memory. */
export function dropCounted(store: SentStore, businessId: number, shelf: TillShelf, now = Date.now()): void {
  const all = store.read();
  const kept = all.filter((hold) => now - hold.ackedAt < KEEP_MS && !(hold.businessId === businessId && counts(shelf, hold)));
  if (kept.length !== all.length) store.write(kept);
}
