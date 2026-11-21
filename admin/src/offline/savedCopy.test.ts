import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../services/types';
import { copyOf, COPY_MAX_AGE_MS, answerSettles, currentIdentity, definiteRefusal, holdSavedMe, setSignInUnsure, switchDone, switchEnded, switchSettled, switchUnsettled, tillKey, fillFrom, forgetSaved, newIdentity, noAnswer, restoreTillCopy, sameSignIn, savedMe, saveMe, saveTillCopy, tillCopyKeys } from './savedCopy';
import { replacesSaved, tillShelfKey } from '../pages/counter/shelfAfterSale';
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

  it('a switch on its way saves nobody, in any tab, until 4VD names who is signed in', () => {
    saveMe(user, null, 1_000);
    holdSavedMe(1_000);
    expect(savedMe(2_000)).toBeNull();
    // Kept in the browser's storage: every tab sees it.
    expect(localStorage.getItem('4vd.offline.switch')).not.toBeNull();
    expect(switchUnsettled()).toBe(true);
    // A profile save meanwhile (the screens still show the person being left) saves nothing.
    saveMe(user, null, 1_500);
    expect(savedMe(2_000)).toBeNull();
    switchSettled();
    expect(switchUnsettled()).toBe(false);
    saveMe({ ...user, businessId: 4 }, null, 1_600);
    expect(savedMe(2_000)?.user.businessId).toBe(4);
  });

  it('only a check asked after the switch request was over says who is signed in', () => {
    const first = holdSavedMe(1_000);
    // Asked before the switch, or while it was on its way: it may name the person being left.
    expect(answerSettles(500, 1_200)).toBe(false);
    expect(answerSettles(1_100, 1_200)).toBe(false);
    switchEnded(first.id, 1_300);
    expect(answerSettles(1_250, 1_400)).toBe(false);
    // Asked the moment it ended (the recheck right after a lost answer) settles it.
    expect(answerSettles(1_300, 1_400)).toBe(true);
    // A switch whose tab closed before it ended: over by two minutes later.
    switchSettled();
    holdSavedMe(10_000);
    expect(answerSettles(20_000, 30_000)).toBe(false);
    expect(answerSettles(131_000, 131_500)).toBe(true);
    switchSettled();
    expect(answerSettles(0)).toBe(true);
  });

  it('says when a switch was already in doubt, so a no to the next one saves nobody', () => {
    expect(holdSavedMe().already).toBe(false);
    // The first switch got no answer; the retry is refused ("at the Counter already"): still unsettled.
    expect(holdSavedMe().already).toBe(true);
    switchSettled();
    expect(holdSavedMe().already).toBe(false);
    switchSettled();
  });

  it('two switches at once (two tabs) each have their own note: a no to one never ends the other', () => {
    const wrongPin = holdSavedMe(1_000);
    const other = holdSavedMe(1_100);
    expect(wrongPin.id).not.toBe(other.id);
    // The first is refused: only its own note goes, the other is still on its way.
    switchEnded(wrongPin.id, 1_200);
    expect(switchDone(wrongPin.id)).toBe(true);
    expect(switchUnsettled()).toBe(true);
    saveMe(user, null, 1_250);
    expect(savedMe(1_300)).toBeNull();
    // A check asked now still may name the person being left.
    expect(answerSettles(1_300, 1_300)).toBe(false);
    switchEnded(other.id, 1_400);
    expect(answerSettles(1_350, 1_500)).toBe(false);
    expect(answerSettles(1_400, 1_500)).toBe(true);
    // Done with the last one: nothing is on hold any more.
    expect(switchDone(other.id)).toBe(false);
    expect(switchUnsettled()).toBe(false);
  });

  it('reads a note from before switches had their own ids as one still on its way', () => {
    localStorage.setItem('4vd.offline.switch', JSON.stringify({ began: 1_000 }));
    expect(switchUnsettled()).toBe(true);
    expect(answerSettles(1_100, 1_200)).toBe(false);
    expect(holdSavedMe(1_300).already).toBe(true);
    switchSettled();
  });

  it('this tab saves nobody while it is unsure who is signed in, even once the other tab settled the switch', () => {
    setSignInUnsure(true);
    expect(switchUnsettled()).toBe(false);
    saveMe(user, null, 1_000);
    expect(savedMe(1_100)).toBeNull();
    setSignInUnsure(false);
    saveMe(user, null, 1_200);
    expect(savedMe(1_300)?.user.id).toBe(user.id);
  });

  it('only a clear no to a switch counts as refused; a lost answer may hide a switch that happened', () => {
    expect(definiteRefusal(new ApiError('wrong PIN', 422, 'WRONG_PIN'))).toBe(true);
    expect(definiteRefusal(new ApiError('locked', 429, 'PIN_LOCKED'))).toBe(true);
    expect(definiteRefusal(new ApiError('not allowed', 403, null))).toBe(true);
    expect(definiteRefusal(new ApiError('signed out', 401, null))).toBe(false);
    expect(definiteRefusal(new ApiError('timeout', 408, null))).toBe(false);
    expect(definiteRefusal(new ApiError('no answer', 0, 'NETWORK'))).toBe(false);
    expect(definiteRefusal(new ApiError('busy', 503, null))).toBe(false);
    // The switch went through but its answer's body was cut off.
    expect(definiteRefusal(new ApiError('The server answered with status 200', 200, null))).toBe(false);
    expect(definiteRefusal(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('a check that names another person or another business is not the same sign-in', () => {
    expect(sameSignIn(user, { ...user })).toBe(true);
    expect(sameSignIn(user, { ...user, businessId: 4 })).toBe(false);
    expect(sameSignIn(user, { ...user, id: 8 })).toBe(false);
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
    expect(fillFrom(client, copy, 3, 11_000)).toBe(true);
    expect(client.getQueryData(shelf!)).toEqual({ products: [1] });
    expect(client.getQueryState(shelf!)?.dataUpdatedAt).toBe(8_000);
    // What 4VD answered wins.
    expect(client.getQueryData(settings!)).toEqual({ printer: { enabled: false } });
    expect(fillFrom(new QueryClient(), copy, 3, 10_000 + COPY_MAX_AGE_MS + 1)).toBe(false);
    expect(fillFrom(new QueryClient(), null, 3)).toBe(false);
    // Another business's copy fills nothing here.
    expect(fillFrom(new QueryClient(), copy, 4, 11_000)).toBe(false);
  });

  it('keeps only the till’s own lists, never what another screen fetched under the shared names', () => {
    const client = new QueryClient();
    // The Customers page (another tab, during a switch) fills the shared list: not the till's.
    client.setQueryData(['customers'], [{ id: 99, business: 'B' }]);
    client.setQueryData(['settings'], { name: 'B' });
    expect(copyOf(client, 3).queries).toEqual([]);
    client.setQueryData(tillKey(3, 'customers'), [{ id: 1 }]);
    expect(copyOf(client, 3).queries.map((one) => one.key)).toEqual([tillKey(3, 'customers')]);
    // A copy saved before the till had its own names fills nothing.
    const old = { savedAt: 10_000, queries: [{ key: ['customers'], data: [{ id: 99 }], updatedAt: 9_000 }] };
    const fresh = new QueryClient();
    expect(fillFrom(fresh, old, 3, 11_000)).toBe(false);
    expect(fresh.getQueryData(['customers'])).toBeUndefined();
  });
});

/** Just enough IndexedDB for savedCopy.ts: one store, each request answered on a later tick, a transaction done after its requests. */
function fakeIndexedDB() {
  const rows = new Map<string, unknown>();
  const later = (fn: () => void) => setTimeout(fn, 0);
  const db = {
    close() {},
    transaction() {
      let aborted = false;
      const tx: { oncomplete?: () => void; onabort?: () => void; objectStore: () => unknown; abort: () => void } = {
        objectStore: () => store,
        abort: () => {
          aborted = true;
          later(() => tx.onabort?.());
        },
      };
      let open = 0;
      const ask = <T,>(run: () => T) => {
        const request: { result?: T; onsuccess?: () => void } = {};
        open += 1;
        later(() => {
          if (aborted) return;
          request.result = run();
          // A request made from onsuccess belongs to the same transaction (it isn't done yet).
          request.onsuccess?.();
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
    client.setQueryData(tillKey(3, 'customers'), [{ id: 1 }]);
    expect(await saveTillCopy(client, owner, currentIdentity())).toEqual(shelf);
    expect([...rows.keys()].sort()).toEqual(['3:7', 'shelf:3']);
    // Another cashier of the same business: the same saved shelf.
    const other = new QueryClient();
    expect(await restoreTillCopy(other, { businessId: 3, userId: 8 }, currentIdentity())).toBe(true);
    expect(other.getQueryData(tillShelfKey(3))).toEqual(shelf);
    expect(other.getQueryData(tillKey(3, 'customers'))).toBeUndefined();
  });

  it('never puts an older shelf over a newer one another Counter on this PC saved', async () => {
    const { rows, api } = fakeIndexedDB();
    vi.stubGlobal('indexedDB', api);
    const savedShelf = () => (rows.get('shelf:3') as { queries: Array<{ data: unknown }> } | undefined)?.queries[0]?.data;
    // Counter A sold the last one: its shelf (asked at 20) says none left.
    const a = new QueryClient();
    a.setQueryData(tillShelfKey(3), { products: [{ id: 1, stock: 0 }], counted: [], askedAt: 20 });
    expect(await saveTillCopy(a, owner, currentIdentity())).toEqual({ products: [{ id: 1, stock: 0 }], counted: [], askedAt: 20 });
    // Counter B still has the shelf from before the sale (asked at 10): its customers are kept, its shelf is not.
    const b = new QueryClient();
    b.setQueryData(tillShelfKey(3), { products: [{ id: 1, stock: 1 }], counted: [], askedAt: 10 });
    b.setQueryData(tillKey(3, 'customers'), [{ id: 5 }]);
    expect(await saveTillCopy(b, { businessId: 3, userId: 8 }, currentIdentity())).toBeNull();
    expect(savedShelf()).toEqual({ products: [{ id: 1, stock: 0 }], counted: [], askedAt: 20 });
    expect(rows.has('3:8')).toBe(true);
    // The same fetch with a sale taken off it here later wins; the copy from before that sale doesn't.
    a.setQueryData(tillShelfKey(3), { products: [{ id: 1, stock: 0 }, { id: 2, stock: 3 }], counted: [], askedAt: 20, patchedAt: 30 });
    expect(await saveTillCopy(a, owner, currentIdentity())).not.toBeNull();
    const before = new QueryClient();
    before.setQueryData(tillShelfKey(3), { products: [{ id: 1, stock: 0 }, { id: 2, stock: 4 }], counted: [], askedAt: 20 });
    expect(await saveTillCopy(before, owner, currentIdentity())).toBeNull();
    expect(savedShelf()).toMatchObject({ patchedAt: 30 });
  });

  it('orders two Counters’ shelves by when 4VD read them, not by when this PC asked', async () => {
    const { rows, api } = fakeIndexedDB();
    vi.stubGlobal('indexedDB', api);
    const savedShelf = () => (rows.get('shelf:3') as { queries: Array<{ data: { asOf?: unknown } }> } | undefined)?.queries[0]?.data;
    // A asked first but reached 4VD after the last unit's sale went in: it counts the sale and has none left.
    const a = new QueryClient();
    a.setQueryData(tillShelfKey(3), { products: [{ id: 1, stock: 0 }], counted: ['k1'], askedAt: 100, asOf: { from: 500, to: 510 } });
    expect(await saveTillCopy(a, owner, currentIdentity())).not.toBeNull();
    // B asked later but 4VD read it before the sale: one unit. Its answer comes late; it must not go over A's.
    const b = new QueryClient();
    b.setQueryData(tillShelfKey(3), { products: [{ id: 1, stock: 1 }], counted: [], askedAt: 200, asOf: { from: 300, to: 310 } });
    expect(await saveTillCopy(b, owner, currentIdentity())).toBeNull();
    expect(savedShelf()?.asOf).toEqual({ from: 500, to: 510 });
    // Read while A was being read (the two overlap): it can't be told newer, so A stays.
    b.setQueryData(tillShelfKey(3), { products: [{ id: 1, stock: 1 }], counted: [], askedAt: 210, asOf: { from: 505, to: 520 } });
    expect(await saveTillCopy(b, owner, currentIdentity())).toBeNull();
    // Read after A was: it replaces it.
    b.setQueryData(tillShelfKey(3), { products: [{ id: 1, stock: 0 }], counted: [], askedAt: 220, asOf: { from: 600, to: 610 } });
    expect(await saveTillCopy(b, owner, currentIdentity())).not.toBeNull();
  });

  it('keeps a shelf with this till’s own sales taken off over one asked before the last of them was answered', () => {
    // Saved: fetched at 100, then a sale here answered at 150 was taken off it.
    const saved = { askedAt: 100, patchedAt: 150, asOf: { from: 1_000, to: 1_010 } };
    // Another Counter asked at 120 (4VD read it later, but maybe before that sale went in): not over it.
    expect(replacesSaved({ askedAt: 120, asOf: { from: 1_100, to: 1_110 } }, saved)).toBe(false);
    // Asked after the sale was answered: 4VD counts it.
    expect(replacesSaved({ askedAt: 160, asOf: { from: 1_200, to: 1_210 } }, saved)).toBe(true);
    // An older 4VD (no server times): this PC's clock, between two of those only.
    expect(replacesSaved({ askedAt: 90 }, { askedAt: 100 })).toBe(false);
    expect(replacesSaved({ askedAt: 5_000 }, saved)).toBe(false);
    expect(replacesSaved({ askedAt: 110 }, { askedAt: 100 })).toBe(true);
    expect(replacesSaved({ askedAt: 1 }, undefined)).toBe(true);
  });

  it('never takes two reads 4VD made within the same moment for one, nor lets either replace the other', () => {
    const counted = { askedAt: 100, fetchId: 'a', asOf: { from: 1_000, to: 1_000 } };
    const stale = { askedAt: 101, fetchId: 'b', asOf: { from: 1_000, to: 1_000 } };
    expect(replacesSaved(stale, counted)).toBe(false);
    expect(replacesSaved(counted, stale)).toBe(false);
    // Read a moment later: newer.
    expect(replacesSaved({ askedAt: 102, fetchId: 'c', asOf: { from: 1_001, to: 1_002 } }, counted)).toBe(true);
    // The same fetch with a sale taken off here since: kept.
    expect(replacesSaved({ ...counted, patchedAt: 150 }, counted)).toBe(true);
    expect(replacesSaved(counted, { ...counted, patchedAt: 150 })).toBe(false);
  });

  it('saves nothing of the till while a switch isn’t settled, and never fills screens for the next person', async () => {
    const { rows, api } = fakeIndexedDB();
    vi.stubGlobal('indexedDB', api);
    const client = new QueryClient();
    client.setQueryData(tillShelfKey(3), shelf);
    holdSavedMe();
    expect(await saveTillCopy(client, owner, currentIdentity())).toBeNull();
    expect(rows.size).toBe(0);
    switchSettled();
    // Settled in another tab, but this one hasn't heard who is signed in yet: still nothing.
    setSignInUnsure(true);
    expect(await saveTillCopy(client, owner, currentIdentity())).toBeNull();
    expect(rows.size).toBe(0);
    setSignInUnsure(false);
    expect(await saveTillCopy(client, owner, currentIdentity())).not.toBeNull();
    // A restore started for the last person, finishing after the next one signed in: nothing filled.
    const fresh = new QueryClient();
    const since = currentIdentity();
    newIdentity();
    expect(await restoreTillCopy(fresh, owner, since)).toBe(false);
    expect(fresh.getQueryData(tillShelfKey(3))).toBeUndefined();
  });

  it('writes the shelf only when it changed in this page, never because the customers did', async () => {
    const { rows, api } = fakeIndexedDB();
    vi.stubGlobal('indexedDB', api);
    const client = new QueryClient();
    client.setQueryData(tillShelfKey(3), shelf);
    client.setQueryData(tillKey(3, 'customers'), [{ id: 1 }]);
    expect(await saveTillCopy(client, owner, currentIdentity(), false)).toBeNull();
    expect([...rows.keys()]).toEqual(['3:7']);
  });

  it('never writes a copy for someone who signed out while it was on its way', async () => {
    const { rows, api } = fakeIndexedDB();
    vi.stubGlobal('indexedDB', api);
    const client = new QueryClient();
    client.setQueryData(tillKey(3, 'customers'), [{ id: 1 }]);
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
