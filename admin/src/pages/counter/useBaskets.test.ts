import { describe, expect, it } from 'vitest';
import { type Basket, type BasketState, changeBasket, changeLines, type PendingSale, withoutBasket, withPending } from './useBaskets';

const bread = { productId: 7, name: 'Bread', quantity: 1, discount: '' };
const basket = (id: string, extra: Partial<Basket> = {}): Basket => ({ id, startedAt: 0, lines: [bread], ...extra });
const sale: PendingSale = {
  key: 'key-1',
  payment: { paidBy: 'tab', tendered: null, customerId: 3, cardAmount: null },
  body: { items: [{ productId: 7, quantity: 1 }], notes: null, customerId: 3, paidNow: false },
  total: 0.6,
  at: '2026-11-20T10:00:00.000Z',
};
const twoBaskets = (): BasketState => ({ baskets: [basket('a'), basket('b')], current: 'a' });

describe('a basket whose sale is on its way', () => {
  it('keeps the sale and its key with the basket until the server answers', () => {
    const sent = withPending(twoBaskets(), 'a', sale);
    expect(sent.baskets[0]?.pending).toEqual(sale);
    expect(sent.baskets[1]?.pending).toBeUndefined();
  });

  it('can’t get other lines, a customer or a rabat meanwhile: Send it again sends the same sale', () => {
    const sent = withPending(twoBaskets(), 'a', sale);
    const more = changeLines(sent, (lines) => [...lines, { productId: 8, name: 'Milk', quantity: 1, discount: '' }]);
    expect(more.baskets[0]?.lines).toEqual([bread]);
    const other = changeBasket(sent, { customerId: 9, discount: '10' });
    expect(other.baskets[0]).toEqual(sent.baskets[0]);
  });

  it('leaves the other baskets free', () => {
    const sent = withPending(twoBaskets(), 'a', sale);
    const onB = changeLines({ ...sent, current: 'b' }, (lines) => lines.map((line) => ({ ...line, quantity: 2 })));
    expect(onB.baskets[1]?.lines[0]?.quantity).toBe(2);
  });

  it('is free again once the server said no', () => {
    const freed = withPending(withPending(twoBaskets(), 'a', sale), 'a', null);
    expect(freed.baskets[0]).not.toHaveProperty('pending');
    expect(changeLines(freed, () => []).baskets[0]?.lines).toEqual([]);
  });

  it('goes, with its sale, once it is recorded; the next basket comes up', () => {
    const paid = withoutBasket(withPending(twoBaskets(), 'a', sale), 'a');
    expect(paid).toEqual({ baskets: [basket('b')], current: 'b' });
    const last = withoutBasket({ baskets: [basket('a', { pending: sale })], current: 'a' }, 'a', () => basket('fresh', { lines: [] }));
    expect(last).toEqual({ baskets: [{ id: 'fresh', startedAt: 0, lines: [] }], current: 'fresh' });
  });
});

describe('a basket at the till', () => {
  it('starts its clock with the first product, not when it was opened', () => {
    const empty: BasketState = { baskets: [basket('a', { lines: [], startedAt: 5 })], current: 'a' };
    expect(changeLines(empty, () => [bread], 1000).baskets[0]?.startedAt).toBe(1000);
    expect(changeLines(changeLines(empty, () => [bread], 1000), (lines) => lines, 2000).baskets[0]?.startedAt).toBe(1000);
  });
});
