import { roundMoney } from '../../utils/money.js';

/** A promotion running right now, as the price rules need it. */
export interface RunningPromotion {
  id: number;
  name: string;
  percentOff: number;
  productId: number | null;
  categoryId: number | null;
  endsAt: Date;
}

/** The biggest running promotion that covers this product, or null. Discounts never stack. */
export function bestPromotionFor(
  product: { id: number; categoryId: number },
  promotions: RunningPromotion[],
): RunningPromotion | null {
  let best: RunningPromotion | null = null;
  for (const promotion of promotions) {
    const covers = promotion.productId === product.id || promotion.categoryId === product.categoryId;
    if (covers && (!best || promotion.percentOff > best.percentOff)) best = promotion;
  }
  return best;
}

export function discountedPrice(price: number, percentOff: number): number {
  return roundMoney(price * (1 - percentOff / 100));
}

/** The lowest price allowed: cost plus the minimum margin, e.g. cost 10 and 10% gives 11. */
export function minimumPrice(cost: number, minimumMarginPercent: number): number {
  return roundMoney(cost * (1 + minimumMarginPercent / 100));
}

/**
 * Unit price for a sale: the bulk-tier price, or the promotion price when
 * that is lower. Returns which promotion was used, if it won.
 */
export function priceWithPromotion(
  basePrice: number,
  tierPrice: number,
  promotion: RunningPromotion | null,
): { pricePerUnit: number; promotionId: number | null } {
  if (!promotion) return { pricePerUnit: tierPrice, promotionId: null };
  const promotionPrice = discountedPrice(basePrice, promotion.percentOff);
  return promotionPrice < tierPrice
    ? { pricePerUnit: promotionPrice, promotionId: promotion.id }
    : { pricePerUnit: tierPrice, promotionId: null };
}
