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
export function afterSaleRefresh(sale: { tab: boolean; customer: boolean; shortDated: boolean; delivery: boolean; offer: boolean }): { refetch: Key[]; stale: Key[] } {
  const refetch: Key[] = [['counter', 'today'], ['cash']];
  const stale: Key[] = [['products'], ['inventory'], ['sales'], ['analytics'], ['reports'], ['activity'], ['documents'], ['money'], ['notifications']];
  (sale.tab || sale.customer ? refetch : stale).push(['customers']);
  (sale.shortDated ? refetch : stale).push(['expiry']);
  if (sale.delivery) refetch.push(TO_DELIVER_KEY);
  if (sale.offer) refetch.push(['offers']);
  return { refetch, stale };
}
