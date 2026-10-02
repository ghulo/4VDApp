import { describe, expect, it } from 'vitest';
import {
  bestPromotionFor,
  discountedPrice,
  minimumPrice,
  priceWithPromotion,
  type RunningPromotion,
} from '../src/services/pricing/promotions.js';

const promotion = (overrides: Partial<RunningPromotion>): RunningPromotion => ({
  id: 1,
  name: 'Sale',
  percentOff: 10,
  productId: null,
  categoryId: null,
  endsAt: new Date('2026-10-08'),
  ...overrides,
});

describe('promotion pricing', () => {
  it('should pick the biggest promotion covering the product, by product or category', () => {
    const promotions = [
      promotion({ id: 1, percentOff: 10, categoryId: 5 }),
      promotion({ id: 2, percentOff: 25, productId: 7 }),
      promotion({ id: 3, percentOff: 50, productId: 8 }),
    ];

    expect(bestPromotionFor({ id: 7, categoryId: 5 }, promotions)?.id).toBe(2);
    expect(bestPromotionFor({ id: 9, categoryId: 5 }, promotions)?.id).toBe(1);
    expect(bestPromotionFor({ id: 9, categoryId: 6 }, promotions)).toBeNull();
  });

  it('should round discounted and minimum prices to cents', () => {
    expect(discountedPrice(19.99, 15)).toBe(16.99);
    expect(minimumPrice(10, 12.5)).toBe(11.25);
  });

  it('should use the promotion only when it beats the bulk price, never both', () => {
    const tenOff = promotion({ id: 4, percentOff: 10 });

    expect(priceWithPromotion(100, 100, tenOff)).toEqual({ pricePerUnit: 90, promotionId: 4 });
    expect(priceWithPromotion(100, 80, tenOff)).toEqual({ pricePerUnit: 80, promotionId: null });
    expect(priceWithPromotion(100, 100, null)).toEqual({ pricePerUnit: 100, promotionId: null });
  });
});
