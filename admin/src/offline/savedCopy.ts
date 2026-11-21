/*
 * What this PC keeps so the Counter can start without internet (the Windows
 * app at the shop opens the saved copy of 4VD, see public/sw.js):
 * - who is signed in here (auth/me) and what their role may do, in the
 *   browser's storage; used only when 4VD can't be reached at all, never when
 *   it says the sign-in is over;
 * - the till's data (its shelf, its settings, the shop's rules, the business,
 *   the customers), per business and person, in IndexedDB, written while the
 *   Counter is open.
 * Both go when someone signs out here, so the next person never sees them.
 */

import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { Permissions } from '../auth/permissions';
import type { User } from '../services/types';
import { tillShelfKey } from '../pages/counter/shelfAfterSale';

const ME_KEY = '4vd.offline.me';
const DB_NAME = '4vd-offline';
const STORE = 'till';
/** A copy older than this is too old to sell from (prices, stock): the till waits for the internet instead. */
export const COPY_MAX_AGE_MS = 7 * 24 * 3600_000;

export interface SavedMe {
  user: User;
  permissions: Permissions | null;
  savedAt: number;
}

/** Signed in (or checked) just now: keep who it is, for a start without internet. */
export function saveMe(user: User, permissions: Permissions | null, now = Date.now()): void {
  try {
    localStorage.setItem(ME_KEY, JSON.stringify({ user, permissions, savedAt: now } satisfies SavedMe));
  } catch {
    // No room: an offline start just shows the sign-in page.
  }
}

/** Who was signed in here last, if it is recent enough to start the till with. */
export function savedMe(now = Date.now()): SavedMe | null {
  try {
    const saved = JSON.parse(localStorage.getItem(ME_KEY) ?? 'null') as SavedMe | null;
    if (!saved?.user || typeof saved.savedAt !== 'number' || now - saved.savedAt > COPY_MAX_AGE_MS) return null;
    return saved;
  } catch {
    return null;
  }
}

/** Signed out (or the sign-in is over): nothing of this person stays for a start without internet. */
export function forgetSaved(): void {
  try {
    localStorage.removeItem(ME_KEY);
  } catch {
    // Nothing kept.
  }
  void withStore('readwrite', (store) => store.clear()).catch(() => undefined);
}

/** The queries the till needs to sell, for this business. */
export const tillCopyKeys = (businessId: number): QueryKey[] => [
  tillShelfKey(businessId),
  ['counter', 'settings'],
  ['settings'],
  ['settings', 'rules'],
  ['business'],
  ['customers'],
];

export interface TillCopy {
  savedAt: number;
  queries: Array<{ key: QueryKey; data: unknown; updatedAt: number }>;
}

/** What to keep: each of the till's queries that has data. */
export function copyOf(client: QueryClient, businessId: number, now = Date.now()): TillCopy {
  const queries = tillCopyKeys(businessId).flatMap((key) => {
    const state = client.getQueryState(key);
    return state?.data === undefined ? [] : [{ key, data: state.data, updatedAt: state.dataUpdatedAt }];
  });
  return { savedAt: now, queries };
}

/**
 * Puts a saved copy into the till's queries, only where they have nothing yet
 * (what 4VD answered always wins). Each keeps the time it was fetched, so it
 * is fetched again as soon as 4VD can be reached. False when there was nothing to fill.
 */
export function fillFrom(client: QueryClient, copy: TillCopy | null, now = Date.now()): boolean {
  if (!copy || now - copy.savedAt > COPY_MAX_AGE_MS) return false;
  let filled = false;
  for (const { key, data, updatedAt } of copy.queries) {
    if (client.getQueryData(key) !== undefined) continue;
    client.setQueryData(key, data, { updatedAt });
    filled = true;
  }
  return filled;
}

const copyId = (owner: { businessId: number; userId: number }) => `${owner.businessId}:${owner.userId}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('No IndexedDB'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB refused'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB aborted'));
    });
  } finally {
    db.close();
  }
}

/** Keep the till's data for this person in this business (the newest copy replaces the last). */
export async function saveTillCopy(client: QueryClient, owner: { businessId: number; userId: number }): Promise<void> {
  const copy = copyOf(client, owner.businessId);
  if (copy.queries.length === 0) return;
  await withStore('readwrite', (store) => store.put(copy, copyId(owner)));
}

/** Fill the till's empty queries from this person's saved copy for this business. False when there was none (or it is too old). */
export async function restoreTillCopy(client: QueryClient, owner: { businessId: number; userId: number }): Promise<boolean> {
  try {
    const copy = (await withStore<TillCopy | undefined>('readonly', (store) => store.get(copyId(owner)) as IDBRequest<TillCopy | undefined>)) ?? null;
    return fillFrom(client, copy);
  } catch {
    return false;
  }
}
