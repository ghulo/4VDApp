import { describe, expect, it } from 'vitest';
import { describeProductChanges, type ProductSnapshot } from '../src/services/activity/describeProductChanges.js';
import { sayIn } from '../src/i18n/activityText.js';

const sentence = (after: ProductSnapshot, language: 'en' | 'sq' = 'en') => {
  const result = describeProductChanges(base, after);
  return result ? sayIn(result.say, language) : null;
};

const base: ProductSnapshot = {
  name: 'Oak Chair',
  description: null,
  categoryId: 1,
  price: 89,
  costPrice: 45,
  vatExempt: false,
  imageUrl: null,
  sku: 'CHAIR-1',
  isActive: true,
  vatRate: 18,
  originCountry: null,
  bulkPricingTiers: [{ quantity: 10, price: 80 }],
};

describe('describeProductChanges', () => {
  it('should lead with a price change and list the other fields', () => {
    const result = describeProductChanges(base, { ...base, price: 95, sku: 'CHAIR-2' });

    expect(result && sayIn(result.say, 'en')).toBe('Changed price of Oak Chair from €89.00 to €95.00 (also changed SKU)');
    expect(result && sayIn(result.say, 'sq').replace(/\s/g, ' ')).toBe('Ndryshoi çmimin e Oak Chair nga 89,00 € në 95,00 € (ndryshoi edhe SKU)');
    expect(result?.details).toEqual({ price: { from: 89, to: 95 }, sku: { from: 'CHAIR-1', to: 'CHAIR-2' } });
  });

  it('should describe hiding a product', () => {
    expect(sentence({ ...base, isActive: false })).toBe('Hid Oak Chair from the app');
  });

  it('should describe a rename using both names', () => {
    expect(sentence({ ...base, name: 'Oak Dining Chair' })).toBe(
      'Renamed Oak Chair to Oak Dining Chair',
    );
  });

  it('should list plain field changes', () => {
    expect(sentence({ ...base, description: 'Solid oak', costPrice: 50 })).toBe(
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
