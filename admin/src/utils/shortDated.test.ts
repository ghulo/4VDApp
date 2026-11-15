import { describe, expect, it } from 'vitest';
import type { ExpiryDate } from '../services/types';
import { offersByProduct, tapShortDated } from './shortDated';

const batch = (patch: Partial<ExpiryDate>): ExpiryDate => ({
  id: 1,
  productId: 1,
  productName: 'Milk',
  quantity: 5,
  remaining: 5,
  expiresOn: '2026-11-17',
  daysLeft: 2,
  note: null,
  addedBy: null,
  costEach: 0.5,
  valueAtCost: 2.5,
  price: 1,
  shortDated: { percentOff: 30, price: 0.7 },
  ...patch,
});

describe('short-dated offers', () => {
  it('offers the batch that runs out first, skipping ones not short-dated or sold', () => {
    const offers = offersByProduct([
      batch({ id: 1, daysLeft: 2 }),
      batch({ id: 2, daysLeft: 1, shortDated: { percentOff: 50, price: 0.5 } }),
      batch({ id: 3, daysLeft: 0, remaining: 0 }),
      batch({ id: 4, productId: 2, shortDated: null }),
    ]);
    expect(offers.get(1)).toMatchObject({ id: 2, percentOff: 50 });
    expect(offers.has(2)).toBe(false);
  });

  it('adds one stickered unit per tap, up to the line and the batch, then none again', () => {
    const offer = { id: 9, percentOff: 30, price: 0.7, remaining: 2, daysLeft: 1 };
    const first = tapShortDated(undefined, offer, 3);
    const second = tapShortDated(first, offer, 3);
    expect([first?.quantity, second?.quantity, tapShortDated(second, offer, 3)]).toEqual([1, 2, undefined]);
    expect(tapShortDated(undefined, offer, 1)?.quantity).toBe(1);
  });
});
