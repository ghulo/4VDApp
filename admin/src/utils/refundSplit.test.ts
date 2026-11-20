import { describe, expect, it } from 'vitest';
import { defaultParts, partsTotal, shareOverLines, singleMethod } from './refundSplit';

describe('the way a refund goes back by default', () => {
  it('follows how the sale was paid', () => {
    expect(defaultParts({ paidBy: 'card', cardAmount: null, receiptTotal: 20 }, 10)).toMatchObject({ card: 10, cash: 0 });
    expect(defaultParts({ paidBy: 'tab', cardAmount: null, receiptTotal: 20 }, 10)).toMatchObject({ tab: 10, cash: 0 });
    expect(defaultParts({ paidBy: 'cash', cardAmount: null, receiptTotal: null }, 10)).toMatchObject({ cash: 10 });
  });

  it('splits a part-card sale in the same share, to the cent', () => {
    expect(defaultParts({ paidBy: 'split', cardAmount: 12.5, receiptTotal: 20 }, 20)).toMatchObject({ card: 12.5, cash: 7.5 });
    const third = defaultParts({ paidBy: 'split', cardAmount: 10, receiptTotal: 30 }, 10);
    expect(third).toMatchObject({ card: 3.33, cash: 6.67 });
    expect(partsTotal(third)).toBe(10);
  });

  it('names the one way when only one has money', () => {
    expect(singleMethod({ cash: 0, card: 5, transfer: 0, tab: 0 })).toBe('card');
    expect(singleMethod({ cash: 2, card: 5, transfer: 0, tab: 0 })).toBeNull();
  });
});

describe('sharing a refund over its lines', () => {
  it('fills the lines in order and keeps every line and every way exact', () => {
    const shares = shareOverLines([10, 0.1, 9.9], { cash: 5, card: 12.33, transfer: 2.67, tab: 0 });
    expect(shares).toEqual([
      { tab: 0, card: 10, transfer: 0, cash: 0 },
      { tab: 0, card: 0.1, transfer: 0, cash: 0 },
      { tab: 0, card: 2.23, transfer: 2.67, cash: 5 },
    ]);
    shares.forEach((share, index) => expect(partsTotal(share)).toBe([10, 0.1, 9.9][index]));
  });
});
