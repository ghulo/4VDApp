import { ValidationError } from '../../errors/httpErrors.js';

export interface PricingTier {
  /** Minimum quantity in one order for this price to apply. */
  quantity: number;
  /** Unit price at or above that quantity. */
  price: number;
}

/**
 * Bulk tiers only make sense if buying more never costs more per unit, so:
 * - every tier needs at least 2 units (1 unit is just the base price)
 * - no two tiers for the same quantity
 * - each tier is cheaper than the base price and than every smaller tier
 *
 * Returns the tiers sorted by quantity.
 */
export function validatePricingTiers(basePrice: number, tiers: PricingTier[]): PricingTier[] {
  const sortedTiers = [...tiers].sort((a, b) => a.quantity - b.quantity);
  const problems: string[] = [];

  let previousPrice = basePrice;
  let previousQuantity = 1;
  for (const tier of sortedTiers) {
    if (tier.quantity === previousQuantity) {
      problems.push(`there are two tiers for quantity ${tier.quantity}`);
    } else if (tier.price >= previousPrice) {
      const comparedTo = previousQuantity === 1 ? `the base price (${basePrice})` : `the tier for ${previousQuantity}`;
      problems.push(`the price for ${tier.quantity}+ (${tier.price}) must be lower than ${comparedTo}`);
    }
    previousPrice = Math.min(previousPrice, tier.price);
    previousQuantity = tier.quantity;
  }

  if (problems.length > 0) {
    throw new ValidationError(`Invalid bulk pricing: ${problems.join('; ')}`);
  }
  return sortedTiers;
}

/** Unit price for an order of `quantity`, using the biggest tier reached. */
export function calculateUnitPrice(basePrice: number, tiers: PricingTier[], quantity: number): number {
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
