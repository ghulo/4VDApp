import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../services/types';
import { copyOf, COPY_MAX_AGE_MS, currentIdentity, fillFrom, forgetSaved, newIdentity, noAnswer, restoreTillCopy, savedMe, saveMe, saveTillCopy, tillCopyKeys } from './savedCopy';
import { tillShelfKey } from '../pages/counter/shelfAfterSale';
import { ApiError } from '../services/apiClient';

const user = { id: 7, name: 'Ana', role: 'employee', businessId: 3, language: 'sq' } as User;

describe('the saved sign-in', () => {
  beforeEach(() => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    });
  });

  it('keeps who signed in here, for a week, and forgets them on sign-out', () => {
    saveMe(user, null, 1_000);
    expect(savedMe(2_000)?.user.id).toBe(7);
    expect(savedMe(1_000 + COPY_MAX_AGE_MS + 1)).toBeNull();
    forgetSaved();
    expect(savedMe(2_000)).toBeNull();
  });

  it('is used only when 4VD gives no answer, never when it says no', () => {
    expect(noAnswer(new TypeError('Failed to fetch'))).toBe(true);
    expect(noAnswer(new ApiError('no answer', 0, 'NETWORK'))).toBe(true);
    expect(noAnswer(new ApiError('busy', 503, null))).toBe(true);
    expect(noAnswer(new ApiError('slow down', 429, null))).toBe(true);
    expect(noAnswer(new ApiError('signed out', 401, null))).toBe(false);
    expect(noAnswer(new ApiError('not allowed', 403, null))).toBe(false);
  });

  it('reads nothing from a broken note', () => {
    localStorage.setItem('4vd.offline.me', '{not json');
    expect(savedMe()).toBeNull();
  });
});

describe("the till's saved data", () => {
  it('copies only the till’s queries for its business that have data', () => {
    const client = new QueryClient();
    const [shelf, settings] = tillCopyKeys(3);
    client.setQueryData(shelf!, { products: [], counted: [], askedAt: 5 });
    client.setQueryData(settings!, { printer: { enabled: true } });
    client.setQueryData(['sales'], ['not kept']);
    client.setQueryData(['products', 'till-shelf', 4], { products: [], counted: [], askedAt: 1 });
    const copy = copyOf(client, 3, 9_000);
    expect(copy.savedAt).toBe(9_000);
    expect(copy.queries.map((one) => one.key)).toEqual([shelf, settings]);
  });

  it('fills only empty queries, keeping when each was fetched (so it is fetched again), and never from an old copy', () => {
    const client = new QueryClient();
    const [shelf, settings] = tillCopyKeys(3);
    client.setQueryData(settings!, { printer: { enabled: false } });
    const copy = { savedAt: 10_000, queries: [{ key: shelf!, data: { products: [1] }, updatedAt: 8_000 }, { key: settings!, data: { printer: { enabled: true } }, updatedAt: 8_000 }] };
    expect(fillFrom(client, copy, 11_000)).toBe(true);
    expect(client.getQueryData(shelf!)).toEqual({ products: [1] });
    expect(client.getQueryState(shelf!)?.dataUpdatedAt).toBe(8_000);
    // What 4VD answered wins.
    expect(client.getQueryData(settings!)).toEqual({ printer: { enabled: false } });
    expect(fillFrom(new QueryClient(), copy, 10_000 + COPY_MAX_AGE_MS + 1)).toBe(false);
    expect(fillFrom(new QueryClient(), null)).toBe(false);
  });
});

/** Just enough IndexedDB for savedCopy.ts: one store, each request answered on a later tick, a transaction done after its requests. */
function fakeIndexedDB() {
  const rows = new Map<string, unknown>();
  const later = (fn: () => void) => setTimeout(fn, 0);
  const db = {
    close() {},
    transaction() {
      const tx: { oncomplete?: () => void; objectStore: () => unknown } = { objectStore: () => store };
      let open = 0;
      const ask = <T,>(run: () => T) => {
        const request: { result?: T } = {};
        open += 1;
        later(() => {
          request.result = run();
          open -= 1;
          if (open === 0) tx.oncomplete?.();
        });
        return request;
      };
      const store = {
        put: (value: unknown, key: string) => ask(() => (rows.set(key, structuredClone(value)), key)),
        get: (key: string) => ask(() => rows.get(key)),
        clear: () => ask(() => rows.clear()),
      };
      return tx;
    },
  };
  const api = {
    open: () => {
      const request: { result?: unknown; onsuccess?: () => void } = {};
      later(() => {
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { rows, api };
}

describe("the till's copy on this PC", () => {
  const owner = { businessId: 3, userId: 7 };
  const shelf = { products: [], counted: ['k1'], askedAt: 5 };

  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  });

  it('keeps the shelf once for the business and the rest per person, and answers the shelf it saved', async () => {
    const { rows, api } = fakeIndexedDB();
    vi.stubGlobal('indexedDB', api);
    const client = new QueryClient();
    client.setQueryData(tillShelfKey(3), shelf);
    client.setQueryData(['customers'], [{ id: 1 }]);
    expect(await saveTillCopy(client, owner, currentIdentity())).toEqual(shelf);
    expect([...rows.keys()].sort()).toEqual(['3:7', 'shelf:3']);
    // Another cashier of the same business: the same saved shelf.
    const other = new QueryClient();
    expect(await restoreTillCopy(other, { businessId: 3, userId: 8 })).toBe(true);
    expect(other.getQueryData(tillShelfKey(3))).toEqual(shelf);
    expect(other.getQueryData(['customers'])).toBeUndefined();
  });

  it('never writes a copy for someone who signed out while it was on its way', async () => {
    const { rows, api } = fakeIndexedDB();
    vi.stubGlobal('indexedDB', api);
    const client = new QueryClient();
    client.setQueryData(['customers'], [{ id: 1 }]);
    const since = currentIdentity();
    // Signed out before the write began…
    forgetSaved();
    expect(await saveTillCopy(client, owner, since)).toBeFalsy();
    // …and while the store was opening.
    const started = currentIdentity();
    const writing = saveTillCopy(client, owner, started);
    newIdentity();
    await expect(writing).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(rows.size).toBe(0);
  });
});
