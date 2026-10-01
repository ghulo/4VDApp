import type { PricingTier } from '../services/types';

/** Same rule as the backend: the biggest tier the quantity reaches. */
export function unitPriceFor(basePrice: number, tiers: PricingTier[], quantity: number): number {
  let unitPrice = basePrice;
  let bestTierQuantity = 0;
  for (const tier of tiers) {
    if (quantity >= tier.quantity && tier.quantity > bestTierQuantity) {
      unitPrice = tier.price;
      bestTierQuantity = tier.quantity;
    }
  }
  return unitPrice;
}
