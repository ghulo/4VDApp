import { describe, expect, it } from 'vitest';
import { describeProductChanges, type ProductSnapshot } from '../src/services/activity/describeProductChanges.js';

const base: ProductSnapshot = {
  name: 'Oak Chair',
  description: null,
  categoryId: 1,
  price: 89,
  costPrice: 45,
  imageUrl: null,
  sku: 'CHAIR-1',
  isActive: true,
  vatRate: 18,
  bulkPricingTiers: [{ quantity: 10, price: 80 }],
};

describe('describeProductChanges', () => {
  it('should lead with a price change and list the other fields', () => {
    const result = describeProductChanges(base, { ...base, price: 95, sku: 'CHAIR-2' });

    expect(result?.summary).toBe('Changed price of Oak Chair from €89.00 to €95.00 (also changed SKU)');
    expect(result?.details).toEqual({ price: { from: 89, to: 95 }, sku: { from: 'CHAIR-1', to: 'CHAIR-2' } });
  });

  it('should describe hiding a product', () => {
    expect(describeProductChanges(base, { ...base, isActive: false })?.summary).toBe('Hid Oak Chair from the app');
  });

  it('should describe a rename using both names', () => {
    expect(describeProductChanges(base, { ...base, name: 'Oak Dining Chair' })?.summary).toBe(
      'Renamed Oak Chair to Oak Dining Chair',
    );
  });

  it('should list plain field changes', () => {
    expect(describeProductChanges(base, { ...base, description: 'Solid oak', costPrice: 50 })?.summary).toBe(
      'Edited Oak Chair: description, cost price',
    );
  });

  it('should ignore bulk prices when the update did not send them', () => {
    expect(describeProductChanges(base, { ...base, bulkPricingTiers: undefined })).toBeNull();
  });

  it('should return null when nothing changed', () => {
    expect(describeProductChanges(base, { ...base })).toBeNull();
  });
});
