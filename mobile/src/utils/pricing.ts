import type { PricingTier, Product } from '../services/types';

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

/**
 * Same rule as the backend: the bulk-tier price, or the promotion price when
 * that is lower. Discounts never stack.
 */
export function salePriceFor(product: Product, quantity: number): { unitPrice: number; isPromotion: boolean } {
  const tierPrice = unitPriceFor(product.price, product.bulkPricingTiers, quantity);
  return product.promotion && product.promotion.price < tierPrice
    ? { unitPrice: product.promotion.price, isPromotion: true }
    : { unitPrice: tierPrice, isPromotion: false };
}
