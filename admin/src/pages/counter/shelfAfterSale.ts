import type { QueryClient } from '@tanstack/react-query';
import { TO_DELIVER_KEY } from '../../services/api';
import type { Product } from '../../services/types';

const toGram = (amount: number) => Math.round(amount * 1000) / 1000;

/**
 * The till's shelf after a sale, worked out from what was sold instead of
 * fetched again: each product loses what went out (two lines of one product,
 * short-dated and the rest, add up), never below nothing. Products not sold
 * stay the very same objects, so nothing else re-renders.
 */
export function shelfAfterSale(shelf: Product[] | undefined, sold: ReadonlyArray<{ productId: number; quantity: number }>): Product[] | undefined {
  if (!shelf) return shelf;
  const gone = new Map<number, number>();
  for (const line of sold) gone.set(line.productId, (gone.get(line.productId) ?? 0) + line.quantity);
  return shelf.map((product) => {
    const out = gone.get(product.id);
    if (out === undefined) return product;
    const quantity = Math.max(0, toGram(product.stock.quantity - out));
    return { ...product, stock: { ...product.stock, quantity, isInStock: quantity > 0, isLowStock: quantity <= product.stock.reorderLevel } };
  });
}

type Key = readonly unknown[];

/**
 * What a recorded sale changes, split in two: the few small things the till
 * shows (its day figures, the drawer) are fetched again in the background, the
 * rest is only marked out of date, so other pages load it fresh when opened
 * and the till never waits on them. The shelf is patched from the sale itself.
 */
export function afterSaleRefresh(sale: { tab: boolean; customer: boolean; datedBatches: boolean; delivery: boolean; offer: boolean }): { refetch: Key[]; stale: Key[] } {
  const refetch: Key[] = [['counter', 'today'], ['cash']];
  const stale: Key[] = [['products'], ['inventory'], ['sales'], ['analytics'], ['reports'], ['activity'], ['documents'], ['money'], ['notifications']];
  (sale.tab || sale.customer ? refetch : stale).push(['customers']);
  // A sale of a product with dated batches (short-dated or not) leaves fewer of them on the shelf: the till's offers and dates follow.
  (sale.datedBatches ? refetch : stale).push(['expiry']);
  if (sale.delivery) refetch.push(TO_DELIVER_KEY);
  if (sale.offer) refetch.push(['offers']);
  return { refetch, stale };
}

/** The till's copy of the shelf. */
export const SHELF_KEY = ['products', 'counter-shelf'] as const;

/**
 * Takes a recorded sale off the till's shelf, once. The shelf it changes is
 * one fetched before the sale was sent: ShelfGate throws away every fetch
 * that may already count it.
 */
export function patchShelf(client: QueryClient, sold: ReadonlyArray<{ productId: number; quantity: number }>): void {
  client.setQueryData<Product[]>(SHELF_KEY, (shelf) => shelfAfterSale(shelf, sold));
}

/**
 * Keeps each sale's stock off the till's shelf exactly once. While a sale is
 * on its way to the server, a shelf fetch can't tell whether it counts it:
 * one that started before or during a send, or ended during one, is not
 * trusted (the till keeps the shelf it has and takes the sale off it itself),
 * and the shelf is fetched again once nothing is on its way. A fetch that
 * starts after the server answered surely counts the sale.
 */
export class ShelfGate {
  private open = 0;
  private turn = 0;
  private missed = false;

  private readonly client: QueryClient;

  constructor(client: QueryClient) {
    this.client = client;
  }

  /** A sale (or a stop, or waiting sales) on its way to the server. */
  async sending<T>(send: () => Promise<T>): Promise<T> {
    this.open += 1;
    this.turn += 1;
    try {
      return await send();
    } finally {
      this.open -= 1;
      this.turn += 1;
      if (this.open === 0 && this.missed) {
        this.missed = false;
        void this.client.invalidateQueries({ queryKey: SHELF_KEY });
      }
    }
  }

  /** The shelf query's fetch: the server's shelf, unless a send overlapped it (then the shelf the till has). */
  async load(fetchShelf: () => Promise<Product[]>): Promise<Product[]> {
    const from = this.turn;
    const quiet = this.open === 0;
    const shelf = await fetchShelf();
    if (quiet && this.open === 0 && this.turn === from) return shelf;
    if (this.open > 0) this.missed = true;
    else setTimeout(() => void this.client.invalidateQueries({ queryKey: SHELF_KEY }), 0);
    return this.client.getQueryData<Product[]>(SHELF_KEY) ?? shelf;
  }
}

const gates = new WeakMap<QueryClient, ShelfGate>();

/** The one gate for this query client's till shelf. */
export function shelfGate(client: QueryClient): ShelfGate {
  let gate = gates.get(client);
  if (!gate) {
    gate = new ShelfGate(client);
    gates.set(client, gate);
  }
  return gate;
}

/** What sales waiting on this PC took off the shelf, by product (they are not in 4VD's stock yet). */
export function heldBy(sales: ReadonlyArray<{ body: { items: ReadonlyArray<{ productId: number; quantity: number }> } }>): Array<{ productId: number; quantity: number }> {
  return sales.flatMap((sale) => sale.body.items.map(({ productId, quantity }) => ({ productId, quantity })));
}
