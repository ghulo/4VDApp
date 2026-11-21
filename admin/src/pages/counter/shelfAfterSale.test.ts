import { describe, expect, it } from 'vitest';
import type { Product } from '../../services/types';
import { QueryClient } from '@tanstack/react-query';
import { afterSaleRefresh, counts, heldOff, patchShelf, ShelfGate, shelfAfterSale, type TillShelf, tillShelfKey } from './shelfAfterSale';
import { dropCounted, holdsFor, keepSent, type SentHold, type SentStore } from './sentHolds';
import { COPY_MAX_AGE_MS } from '../../offline/savedCopy';

const KEY = tillShelfKey(1);
const tillShelf = (products: Product[], counted: string[] | null = [], askedAt = 0): TillShelf => ({ products, counted, askedAt });

const product = (id: number, quantity: number, reorderLevel = 2): Product =>
  ({ id, name: `P${id}`, stock: { quantity, reorderLevel, isInStock: quantity > 0, isLowStock: quantity <= reorderLevel } }) as Product;

describe('shelfAfterSale', () => {
  it('takes what was sold off each product, adding up two lines of one product (short-dated and the rest)', () => {
    const shelf = [product(1, 10), product(2, 5), product(3, 1)];
    const after = shelfAfterSale(shelf, [
      { productId: 1, quantity: 2 },
      { productId: 1, quantity: 3 },
      { productId: 3, quantity: 1 },
    ])!;
    expect(after.map((one) => one.stock.quantity)).toEqual([5, 5, 0]);
    expect(after[1]).toBe(shelf[1]);
    expect(after[2]!.stock).toMatchObject({ isInStock: false, isLowStock: true });
    expect(after[0]!.stock).toMatchObject({ isInStock: true, isLowStock: false });
  });

  it('never goes below nothing, and keeps parts of a kilo to the gram', () => {
    const after = shelfAfterSale([product(1, 1), product(2, 2.5)], [
      { productId: 1, quantity: 4 },
      { productId: 2, quantity: 0.3 },
      { productId: 2, quantity: 0.1 },
    ])!;
    expect(after.map((one) => one.stock.quantity)).toEqual([0, 2.1]);
  });

  it('leaves a shelf that is not loaded yet alone', () => {
    expect(shelfAfterSale(undefined, [{ productId: 1, quantity: 1 }])).toBeUndefined();
  });
});

describe('afterSaleRefresh', () => {
  it('refetches only the small figures the till shows; the rest is only marked out of date', () => {
    const plan = afterSaleRefresh({ tab: false, customer: false, datedBatches: false, delivery: false, offer: false });
    expect(plan.refetch).toEqual([['counter', 'today'], ['cash']]);
    expect(plan.refetch).not.toContainEqual(['products']);
    expect(plan.refetch).not.toContainEqual(['customers']);
    expect(plan.stale).toContainEqual(['sales']);
    expect(plan.stale).toContainEqual(['customers']);
  });

  it('refetches the customers after a sale on a tab or to a customer, the dates and offers after a product with dated batches', () => {
    const plan = afterSaleRefresh({ tab: true, customer: true, datedBatches: true, delivery: true, offer: true });
    expect(plan.refetch).toEqual(expect.arrayContaining([['customers'], ['expiry'], ['deliveries', 'out'], ['offers']]));
    expect(plan.stale).not.toContainEqual(['customers']);
  });
});

describe('ShelfGate', () => {
  /** A shelf fetch the test answers by hand, through the gate like the till's query. */
  function setup(start = 10) {
    const client = new QueryClient();
    const gate = new ShelfGate(client);
    client.setQueryData(KEY, tillShelf([product(1, start)]));
    const fetchShelf = () => {
      let answer!: (shelf: TillShelf) => void;
      const done = client.fetchQuery({ queryKey: KEY, queryFn: () => gate.load(KEY, () => new Promise<TillShelf>((resolve) => (answer = resolve))), staleTime: 0 });
      return { answer: (quantity: number) => answer(tillShelf([product(1, quantity)])), done };
    };
    const send = () => {
      let answer!: () => void;
      const done = gate.sending(() => new Promise<void>((resolve) => (answer = resolve)));
      return { answer, done };
    };
    const onShelf = () => client.getQueryData<TillShelf>(KEY)!.products[0]!.stock.quantity;
    const refetchAsked = () => client.getQueryState(KEY)!.isInvalidated;
    return { client, gate, fetchShelf, send, onShelf, refetchAsked };
  }

  it('takes a sale off once when a shelf fetch started before the sale lands before its answer (it may count it already)', async () => {
    const { fetchShelf, send, onShelf, client } = setup(2);
    const fetch = fetchShelf();
    const sale = send();
    // The server committed the sale before reading the shelf for that fetch: it says 1 left.
    fetch.answer(1);
    await fetch.done;
    sale.answer();
    await sale.done;
    patchShelf(client, 1, [{ productId: 1, quantity: 1 }]);
    expect(onShelf()).toBe(1);
  });

  it('does not trust a fetch that lands after the answer but started before it, and fetches again', async () => {
    const { fetchShelf, send, onShelf, refetchAsked, client } = setup(2);
    const fetch = fetchShelf();
    const sale = send();
    sale.answer();
    await sale.done;
    patchShelf(client, 1, [{ productId: 1, quantity: 1 }]);
    fetch.answer(1);
    await fetch.done;
    expect(onShelf()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refetchAsked()).toBe(true);
  });

  it('keeps the shelf it has while a sale is on its way, and fetches again once it is done', async () => {
    const { fetchShelf, send, onShelf, refetchAsked, client } = setup(2);
    const sale = send();
    const fetch = fetchShelf();
    fetch.answer(1);
    await fetch.done;
    expect(onShelf()).toBe(2);
    expect(refetchAsked()).toBe(false);
    sale.answer();
    await sale.done;
    // Fetched again once nothing is on its way (the till's query starts it at once; the sale's patch tides it over).
    expect(refetchAsked()).toBe(true);
    patchShelf(client, 1, [{ productId: 1, quantity: 1 }]);
    expect(onShelf()).toBe(1);
  });

  it('trusts a fetch that started after the answer came, and one with no sale near it', async () => {
    const { fetchShelf, send, onShelf, refetchAsked } = setup(5);
    const sale = send();
    sale.answer();
    await sale.done;
    const after = fetchShelf();
    after.answer(4);
    await after.done;
    expect(onShelf()).toBe(4);
    const quiet = fetchShelf();
    quiet.answer(3);
    await quiet.done;
    expect(onShelf()).toBe(3);
    expect(refetchAsked()).toBe(false);
  });

  it('still frees the gate when a send fails', async () => {
    const { gate, fetchShelf, onShelf } = setup(5);
    await expect(gate.sending(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    const fetch = fetchShelf();
    fetch.answer(4);
    await fetch.done;
    expect(onShelf()).toBe(4);
  });
});

describe('held sales', () => {
  const vase = (key: string, quantity: number, ackedAt?: number) => ({ key, items: [{ productId: 1, quantity }], ...(ackedAt !== undefined && { ackedAt }) });

  it('keeps every held sale off a shelf that does not count it', () => {
    const shelf = tillShelf([product(1, 3), product(2, 1)], []);
    const held = heldOff([vase('a', 2), { key: 'b', items: [{ productId: 1, quantity: 1 }, { productId: 2, quantity: 0.5 }] }], shelf);
    expect(shelfAfterSale(shelf.products, held)!.map((one) => one.stock.quantity)).toEqual([0, 0.5]);
  });

  it('never takes off twice a waiting sale 4VD already has (its answer was lost): the shelf names it', () => {
    // 2 on the shelf, the server recorded a 1-unit sale whose answer never came, so it also waits on this PC.
    const shelf = tillShelf([product(1, 1)], ['0b6f6c2e-6a1d-4c8e-9a43-3d2b7f1e5a10']);
    const held = heldOff([vase('0B6F6C2E-6A1D-4C8E-9A43-3D2B7F1E5A10', 1)], shelf);
    expect(held).toEqual([]);
    expect(shelfAfterSale(shelf.products, held)![0]!.stock.quantity).toBe(1);
  });

  it('keeps a sent sale off a shelf asked for before 4VD took it, until one asked for after (or that names it)', () => {
    const sent = vase('k', 1, 1_000);
    expect(counts(tillShelf([product(1, 1)], [], 900), sent)).toBe(false);
    expect(counts(tillShelf([product(1, 0)], [], 1_001), sent)).toBe(true);
    // An older 4VD that names nothing: only the time says.
    expect(counts(tillShelf([product(1, 1)], null, 900), sent)).toBe(false);
    expect(counts(tillShelf([product(1, 1)], null, 900), vase('k', 1))).toBe(false);
    expect(counts(undefined, sent)).toBe(false);
  });

  it('holds each sale once, even when a crash left it both queued and sent', () => {
    const items = [{ productId: 1, quantity: 1 }];
    const held = holdsFor(
      [{ key: 'ABC', items, businessId: 1 }, { key: 'x', items, businessId: 2 }],
      [{ key: 'abc', items, businessId: 1, ackedAt: 1 }, { key: 'd', items, businessId: 1, ackedAt: 1 }, { key: 'e', items, businessId: 2, ackedAt: 1 }],
      1,
    );
    expect(held.map((hold) => hold.key)).toEqual(['ABC', 'd']);
    expect(heldOff(held, undefined)).toEqual([{ productId: 1, quantity: 1 }, { productId: 1, quantity: 1 }]);
  });

  it('keeps sent holds on this PC until a shelf for their business counts them', () => {
    let saved: SentHold[] = [];
    const store: SentStore = { read: () => saved, write: (holds) => ((saved = holds), true) };
    expect(keepSent(store, { key: 'a', businessId: 1, items: [{ productId: 1, quantity: 1 }], ackedAt: 1_000 }, 1_000)).toBe(true);
    expect(keepSent(store, { key: 'b', businessId: 2, items: [{ productId: 1, quantity: 1 }], ackedAt: 1_000 }, 1_000)).toBe(true);
    dropCounted(store, 1, tillShelf([], [], 900), 2_000);
    expect(saved.map((hold) => hold.key)).toEqual(['a', 'b']);
    dropCounted(store, 1, tillShelf([], [], 1_500), 2_000);
    expect(saved.map((hold) => hold.key)).toEqual(['b']);
    // A hold outlives any saved shelf that could still be sold from (7 days): at 7 it stays, a day past it it goes.
    dropCounted(store, 1, tillShelf([], [], 0), 1_000 + COPY_MAX_AGE_MS);
    expect(saved.map((hold) => hold.key)).toEqual(['b']);
    dropCounted(store, 1, tillShelf([], [], 0), 1_000 + COPY_MAX_AGE_MS + 24 * 3600_000);
    expect(saved).toEqual([]);
    const full: SentStore = { read: () => [], write: () => false };
    expect(keepSent(full, { key: 'c', businessId: 1, items: [], ackedAt: 1 })).toBe(false);
  });
});
