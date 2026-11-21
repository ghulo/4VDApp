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

import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { Permissions } from '../auth/permissions';
import type { User } from '../services/types';
import { ApiError } from '../services/apiClient';
import { olderShelf, tillShelfKey, type TillShelf } from '../pages/counter/shelfAfterSale';

const ME_KEY = '4vd.offline.me';

/**
 * 4VD gave no answer about the sign-in (no internet, a timeout, a busy or broken server): only then may the
 * sign-in saved on this PC start the till. Any other answer (refused, gone) means it can't.
 */
export function noAnswer(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}
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
  // A switch whose outcome isn't known yet: nobody is saved until 4VD names who is signed in here.
  if (held) return;
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

/**
 * Which sign-in the till copies being written belong to: it moves on whenever the person here changes
 * (signed out, the sign-in over, another person signed in). A write started under an earlier one is dropped.
 */
let identity = 0;
export const currentIdentity = (): number => identity;

/** The person here changes (signed out, another one signed in): copies still being written for the last one are dropped. */
export function newIdentity(): number {
  identity += 1;
  return identity;
}

/**
 * 4VD refused a switch for certain (a 4xx answer: wrong or locked PIN, not allowed): nothing changed on its side.
 * Not a lost or cut-off answer (no internet, a timeout, a busy server, a body that never arrived: the switch may have
 * happened), and not "signed out" (401: the session is over, nobody is saved again).
 */
export function definiteRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 408;
}

let held = false;

/**
 * A switch (business, or cashier at the Counter) is on its way: the saved sign-in is forgotten and nothing is saved
 * again until 4VD names who is signed in (a confirmed answer: releaseSavedMe), so an offline start never reopens the
 * person or business being left. An offline start meanwhile shows the sign-in page.
 */
export function holdSavedMe(): void {
  held = true;
  forgetSavedMe();
}

/** 4VD named who is signed in here (or refused the switch for certain): the saved sign-in may be written again. */
export function releaseSavedMe(): void {
  held = false;
}

/** Whether 4VD's answer names the same person in the same business as the one the screens show. */
export function sameSignIn(shown: Pick<User, 'id' | 'businessId'>, answer: Pick<User, 'id' | 'businessId'>): boolean {
  return shown.id === answer.id && shown.businessId === answer.businessId;
}

/** The saved sign-in no longer names who is signed in (a switch of business or cashier is under way): an offline start shows the sign-in page until 4VD names the new one. */
export function forgetSavedMe(): void {
  try {
    localStorage.removeItem(ME_KEY);
  } catch {
    // Nothing kept.
  }
}

/** Signed out (or the sign-in is over): nothing of this person stays for a start without internet. */
export function forgetSaved(): void {
  newIdentity();
  forgetSavedMe();
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
/** The shelf is kept once per business, not per person: one saved shelf, so a sale held off it is let go only against that one. */
const shelfId = (businessId: number) => `shelf:${businessId}`;
const isShelf = (key: QueryKey, businessId: number) => hashKey(key) === hashKey(tillShelfKey(businessId));

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
  // The transaction is made and its work queued in one go (no await between): a sign-out's clear comes before or after it, never inside.
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

/**
 * Keep the till's data for this person in this business (the newest copy replaces the last; the shelf is the business's).
 * Only while the sign-in it was started under (`since`, from currentIdentity) is still the one here: checked as the write
 * is queued, so a sign-out's clear always comes after it or refuses it. The shelf is written only when asked (`withShelf`:
 * it changed in this page) and never over a newer saved one: another Counter open on this PC with an older shelf never
 * puts sold units back. Answers the shelf that is now saved (null: none was written), so the sales held off it can be
 * let go only once a saved shelf counts them.
 */
export async function saveTillCopy(client: QueryClient, owner: { businessId: number; userId: number }, since: number, withShelf = true): Promise<TillShelf | null> {
  if (since !== identity) return null;
  if (copyOf(client, owner.businessId).queries.length === 0) return null;
  let written: TillShelf | null = null;
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB refused'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB aborted'));
      if (since !== identity) {
        transaction.abort();
        return reject(new Error('Another person is signed in here now'));
      }
      // Read as the write is queued: two saves from this page go in the order their data was read.
      const copy = copyOf(client, owner.businessId);
      const shelf = copy.queries.find((query) => isShelf(query.key, owner.businessId));
      const rest = copy.queries.filter((query) => !isShelf(query.key, owner.businessId));
      const store = transaction.objectStore(STORE);
      // One transaction: the person's copy and the shelf are written together, or neither.
      if (rest.length > 0) store.put({ savedAt: copy.savedAt, queries: rest } satisfies TillCopy, copyId(owner));
      const mine = shelf?.data as TillShelf | undefined;
      if (!withShelf || !shelf || typeof mine?.askedAt !== 'number') return;
      const stored = store.get(shelfId(owner.businessId)) as IDBRequest<TillCopy | undefined>;
      stored.onsuccess = () => {
        const theirs = stored.result?.queries[0]?.data as Partial<TillShelf> | undefined;
        if (olderShelf(mine, theirs)) return;
        store.put({ savedAt: copy.savedAt, queries: [shelf] } satisfies TillCopy, shelfId(owner.businessId));
        written = mine;
      };
    });
  } finally {
    db.close();
  }
  return written;
}

/** Fill the till's empty queries from this person's saved copy for this business. False when there was none (or it is too old). */
export async function restoreTillCopy(client: QueryClient, owner: { businessId: number; userId: number }): Promise<boolean> {
  try {
    const read = (id: string) => withStore<TillCopy | undefined>('readonly', (store) => store.get(id) as IDBRequest<TillCopy | undefined>);
    const mine = (await read(copyId(owner))) ?? null;
    const shelf = (await read(shelfId(owner.businessId))) ?? null;
    // Only the business's own saved shelf, never one kept inside a person's copy.
    const rest = mine && { ...mine, queries: mine.queries.filter((query) => !isShelf(query.key, owner.businessId)) };
    const filledRest = fillFrom(client, rest);
    return fillFrom(client, shelf) || filledRest;
  } catch {
    return false;
  }
}
