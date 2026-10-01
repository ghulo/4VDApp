import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors/httpErrors.js';
import { calculateUnitPrice, validatePricingTiers } from '../src/services/pricing/bulkPricing.js';

describe('validatePricingTiers', () => {
  it('should accept tiers that get cheaper and return them sorted by quantity', () => {
    const tiers = validatePricingTiers(100, [
      { quantity: 50, price: 80 },
      { quantity: 10, price: 90 },
    ]);

    expect(tiers).toEqual([
      { quantity: 10, price: 90 },
      { quantity: 50, price: 80 },
    ]);
  });

  it('should accept no tiers at all', () => {
    expect(validatePricingTiers(100, [])).toEqual([]);
  });

  it('should reject a tier that is not cheaper than the base price', () => {
    expect(() => validatePricingTiers(100, [{ quantity: 10, price: 100 }])).toThrow(ValidationError);
  });

  it('should reject a bigger tier that costs more than a smaller one', () => {
    expect(() =>
      validatePricingTiers(100, [
        { quantity: 10, price: 80 },
        { quantity: 50, price: 85 },
      ]),
    ).toThrow(/50\+/);
  });

  it('should reject two tiers for the same quantity', () => {
    expect(() =>
      validatePricingTiers(100, [
        { quantity: 10, price: 90 },
        { quantity: 10, price: 85 },
      ]),
    ).toThrow(/two tiers for quantity 10/);
  });
});

describe('calculateUnitPrice', () => {
  const tiers = [
    { quantity: 10, price: 90 },
    { quantity: 50, price: 80 },
  ];

  it('should use the base price below the first tier', () => {
    expect(calculateUnitPrice(100, tiers, 9)).toBe(100);
  });

  it('should apply a tier from exactly its quantity', () => {
    expect(calculateUnitPrice(100, tiers, 10)).toBe(90);
  });

  it('should use the biggest tier reached', () => {
    expect(calculateUnitPrice(100, tiers, 500)).toBe(80);
  });

  it('should not depend on the order the tiers are listed in', () => {
    expect(calculateUnitPrice(100, [...tiers].reverse(), 60)).toBe(80);
  });
});
