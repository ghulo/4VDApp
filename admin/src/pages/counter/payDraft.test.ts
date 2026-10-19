import { describe, expect, it } from 'vitest';
import { cashDue, changeFor, EMPTY_PAY, splitFor } from './payDraft';

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
