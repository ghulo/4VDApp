import type { ExpiryDate } from '../services/types';

/** A batch a stickered unit sells cheaper from today. */
export interface ShortDatedOffer {
  /** The batch (its expiry date's id), sent with the sale. */
  id: number;
  percentOff: number;
  price: number;
  /** Units of the batch still on the shelf. */
  remaining: number;
  daysLeft: number;
}

/** The units of a basket line the cashier marked as stickered short-dated ones. */
export interface ShortDatedPick {
  id: number;
  quantity: number;
  price: number;
  percentOff: number;
}

/** Per product, the batch that runs out first among those sold short-dated today. */
export function offersByProduct(batches: ExpiryDate[] | undefined): Map<number, ShortDatedOffer> {
  const offers = new Map<number, ShortDatedOffer>();
  for (const batch of batches ?? []) {
    if (!batch.shortDated || batch.remaining <= 0) continue;
    const known = offers.get(batch.productId);
    if (known && known.daysLeft <= batch.daysLeft) continue;
    offers.set(batch.productId, { id: batch.id, ...batch.shortDated, remaining: batch.remaining, daysLeft: batch.daysLeft });
  }
  return offers;
}

/**
 * One more tap on the short-dated button: one more stickered unit, up to the
 * line's quantity and what is left of the batch; past that it goes back to none.
 */
export function tapShortDated(pick: ShortDatedPick | undefined, offer: ShortDatedOffer, lineQuantity: number): ShortDatedPick | undefined {
  const most = Math.min(Math.floor(lineQuantity), offer.remaining);
  const current = pick?.id === offer.id ? pick.quantity : 0;
  if (most <= 0 || current >= most) return undefined;
  return { id: offer.id, quantity: current + 1, price: offer.price, percentOff: offer.percentOff };
}

/** How many of a line's units are the stickered ones (never more than the line has). */
export const shortDatedUnits = (pick: ShortDatedPick | undefined, lineQuantity: number) => (pick ? Math.min(pick.quantity, Math.floor(lineQuantity)) : 0);
