import { calculateUnitPrice, type PricingTier } from './bulkPricing.js';
import { priceWithPromotion, type RunningPromotion } from './promotions.js';

/**
 * The price level a customer pays per product: the shelf price, or, for a
 * customer who pays wholesale (or a sale switched to it), the wholesale price.
 * A wholesale price above the shelf price is never charged: nobody pays more
 * than a walk-in.
 */
export function levelPrice(shelfPrice: number, wholesalePrice: number | null, wholesale: boolean): number {
  if (!wholesale || wholesalePrice === null) return shelfPrice;
  return Math.min(shelfPrice, wholesalePrice);
}

/**
 * What one costs before any rabat, in this order: the price level (shelf or
 * wholesale), a bulk price when the quantity reaches one and it is lower, then
 * a running promotion (worked out from the shelf price) when it is lower still.
 * The Counter's copy is `listPriceFor` in admin/src/components/BasketForm.tsx.
 */
export function listPrice(p: {
  shelfPrice: number;
  wholesalePrice: number | null;
  wholesale: boolean;
  tiers: PricingTier[];
  quantity: number;
  promotion: RunningPromotion | null;
}): { pricePerUnit: number; promotionId: number | null; wholesale: boolean } {
  const level = levelPrice(p.shelfPrice, p.wholesalePrice, p.wholesale);
  const tierPrice = Math.min(level, calculateUnitPrice(p.shelfPrice, p.tiers, p.quantity));
  const result = priceWithPromotion(p.shelfPrice, tierPrice, p.promotion);
  return { ...result, wholesale: p.wholesale && level < p.shelfPrice };
}
