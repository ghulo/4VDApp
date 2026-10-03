import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { effectSentence } from './activityText';

describe('effectSentence', () => {
  it('should say what an undo puts back', () => {
    const lines = effectSentence(en, { stock: { product: 'Oak Chair', delta: 2 }, money: { amount: -178, day: '2026-10-03T10:00:00Z' } });
    expect(lines[0]).toBe('+2 Oak Chair back in stock');
    expect(lines[1]).toMatch(/^−€178\.00 from Saturday,? 3 October$/);
  });

  it('should say the opposite for a restore', () => {
    expect(effectSentence(en, { stock: { product: 'Oak Chair', delta: 2 } }, 'restore')).toEqual(['−2 Oak Chair taken out of stock']);
  });

  it('should say what an edit goes back to', () => {
    expect(effectSentence(en, { fields: [{ field: 'price', from: 79, to: 89 }] })).toEqual(['Price goes back from €79.00 to €89.00']);
    expect(effectSentence(en, { fields: [{ field: 'bulkPricingTiers', from: [], to: [] }] })).toEqual(['Bulk prices: back to the earlier version']);
  });
});
