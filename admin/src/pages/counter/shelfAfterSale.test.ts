import { describe, expect, it } from 'vitest';
import type { Product } from '../../services/types';
import { afterSaleRefresh, shelfAfterSale } from './shelfAfterSale';

const product = (id: number, quantity: number, reorderLevel = 2): Product =>
  ({ id, name: `P${id}`, stock: { quantity, reorderLevel, isInStock: quantity > 0, isLowStock: quantity <= reorderLevel } }) as Product;

describe('shelfAfterSale', () => {
  it('takes what was sold off each product, adding up two lines of one product (short-dated and the rest)', () => {
    const shelf = [product(1, 10), product(2, 5), product(3, 1)];
    const after = shelfAfterSale(shelf, [
      { productId: 1, quantity: 2 },
      { productId: 1, quantity: 3 },
      { productId: 3, quantity: 1 },
    ])!;
    expect(after.map((one) => one.stock.quantity)).toEqual([5, 5, 0]);
    expect(after[1]).toBe(shelf[1]);
    expect(after[2]!.stock).toMatchObject({ isInStock: false, isLowStock: true });
    expect(after[0]!.stock).toMatchObject({ isInStock: true, isLowStock: false });
  });

  it('never goes below nothing, and keeps parts of a kilo to the gram', () => {
    const after = shelfAfterSale([product(1, 1), product(2, 2.5)], [
      { productId: 1, quantity: 4 },
      { productId: 2, quantity: 0.3 },
      { productId: 2, quantity: 0.1 },
    ])!;
    expect(after.map((one) => one.stock.quantity)).toEqual([0, 2.1]);
  });

  it('leaves a shelf that is not loaded yet alone', () => {
    expect(shelfAfterSale(undefined, [{ productId: 1, quantity: 1 }])).toBeUndefined();
  });
});

describe('afterSaleRefresh', () => {
  it('refetches only the small figures the till shows; the rest is only marked out of date', () => {
    const plan = afterSaleRefresh({ tab: false, customer: false, shortDated: false, delivery: false, offer: false });
    expect(plan.refetch).toEqual([['counter', 'today'], ['cash']]);
    expect(plan.refetch).not.toContainEqual(['products']);
    expect(plan.refetch).not.toContainEqual(['customers']);
    expect(plan.stale).toContainEqual(['sales']);
    expect(plan.stale).toContainEqual(['customers']);
  });

  it('refetches the customers after a sale on a tab or to a customer, the short-dated list after a short-dated unit', () => {
    const plan = afterSaleRefresh({ tab: true, customer: true, shortDated: true, delivery: true, offer: true });
    expect(plan.refetch).toEqual(expect.arrayContaining([['customers'], ['expiry'], ['deliveries', 'out'], ['offers']]));
    expect(plan.stale).not.toContainEqual(['customers']);
  });
});
