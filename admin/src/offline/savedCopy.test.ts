import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../services/types';
import { copyOf, COPY_MAX_AGE_MS, fillFrom, forgetSaved, savedMe, saveMe, tillCopyKeys } from './savedCopy';

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
