import { describe, expect, it } from 'vitest';
import { basketSignature, cashDue, changeFor, draftToOpen, EMPTY_PAY, payMethodForKey, splitFor } from './payDraft';

describe('taking the money', () => {
  it('gives the change on cash', () => {
    expect(changeFor({ ...EMPTY_PAY, tendered: '50' }, 37.4)).toEqual({ given: 50, change: 12.6 });
    expect(changeFor({ ...EMPTY_PAY, tendered: '' }, 37.4)).toBeNull();
    expect(changeFor({ ...EMPTY_PAY, paidBy: 'card', tendered: '50' }, 37.4)).toBeNull();
  });

  it('splits cash and card: the card takes its part, the change comes from the cash', () => {
    const draft = { ...EMPTY_PAY, paidBy: 'split' as const, card: '30', tendered: '10' };
    expect(splitFor(draft, 37.4)).toEqual({ card: 30, cashDue: 7.4, valid: true });
    expect(cashDue(draft, 37.4)).toBe(7.4);
    expect(changeFor(draft, 37.4)).toEqual({ given: 10, change: 2.6 });
    expect(changeFor({ ...draft, tendered: '5' }, 37.4)).toEqual({ given: 5, change: -2.4 });
  });

  it('does not let the card take nothing, or all of it', () => {
    const split = { ...EMPTY_PAY, paidBy: 'split' as const };
    expect(splitFor({ ...split, card: '' }, 20)).toBeNull();
    expect(splitFor({ ...split, card: '0' }, 20)?.valid).toBe(false);
    expect(splitFor({ ...split, card: '20' }, 20)?.valid).toBe(false);
    expect(splitFor({ ...split, card: '19,99' }, 20)).toEqual({ card: 19.99, cashDue: 0.01, valid: true });
    expect(cashDue({ ...split, card: '' }, 20)).toBe(20);
  });
});

describe('a payment left half taken', () => {
  const basket = { lines: [{ productId: 1, quantity: 2, discount: '' }], discount: '', customerId: null };
  const typed = { ...EMPTY_PAY, paidBy: 'split' as const, card: '5', tendered: '10' };

  it('comes back when Pay opens again on the same, unchanged basket', () => {
    const kept = { basketId: 'b1', basket: basketSignature(basket, 12), draft: typed };
    expect(draftToOpen(kept, 'b1', basketSignature(basket, 12), EMPTY_PAY)).toBe(typed);
  });

  it('is dropped for another basket, or once the basket, its rabat, its customer or its total changed', () => {
    const kept = { basketId: 'b1', basket: basketSignature(basket, 12), draft: typed };
    expect(draftToOpen(kept, 'b2', basketSignature(basket, 12), EMPTY_PAY)).toBe(EMPTY_PAY);
    expect(draftToOpen(kept, 'b1', basketSignature({ ...basket, lines: [{ productId: 1, quantity: 3 }] }, 18), EMPTY_PAY)).toBe(EMPTY_PAY);
    expect(draftToOpen(kept, 'b1', basketSignature({ ...basket, discount: '10' }, 12), EMPTY_PAY)).toBe(EMPTY_PAY);
    expect(draftToOpen(kept, 'b1', basketSignature({ ...basket, customerId: 4 }, 12), EMPTY_PAY)).toBe(EMPTY_PAY);
    expect(draftToOpen(kept, 'b1', basketSignature(basket, 11.5), EMPTY_PAY)).toBe(EMPTY_PAY);
    expect(draftToOpen(null, 'b1', basketSignature(basket, 12), EMPTY_PAY)).toBe(EMPTY_PAY);
  });
});

describe("Pay's keys", () => {
  it('picks how the customer pays with function keys only, and no tab offline', () => {
    expect(payMethodForKey('F1', false)).toBe('cash');
    expect(payMethodForKey('F2', false)).toBe('card');
    expect(payMethodForKey('F3', false)).toBe('split');
    expect(payMethodForKey('F4', false)).toBe('tab');
    expect(payMethodForKey('F4', true)).toBeNull();
    expect(payMethodForKey('c', false)).toBeNull();
    expect(payMethodForKey('2', false)).toBeNull();
  });
});
