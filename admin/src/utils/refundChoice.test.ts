import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import type { RefundInfo } from '../services/types';
import { initialChoice, partsOf, refundByInput, refundProblem, waitsForOwner } from './refundChoice';

const sale = (changes: Partial<RefundInfo> = {}): RefundInfo => ({
  saleId: 1,
  soldAt: '2026-11-20T10:00:00Z',
  receiptNumber: 'F-2026-000042',
  paidBy: 'card',
  cardAmount: null,
  receiptTotal: 20,
  tabCustomer: null,
  approval: null,
  ...changes,
});

describe('the refund money step', () => {
  it('starts the way the sale was paid and asks for the terminal tick on a card refund', () => {
    const choice = initialChoice(sale());
    const parts = partsOf(choice, sale(), 10);
    expect(parts).toMatchObject({ card: 10, cash: 0 });
    expect(refundProblem(en, choice, parts, 10, false)).toBe(en.refundMoney.terminalNotDone);
    expect(refundProblem(en, { ...choice, terminalDone: true }, parts, 10, false)).toBeNull();
    // Waiting for the owner: no tick yet, the money hasn't moved.
    expect(refundProblem(en, choice, parts, 10, true)).toBeNull();
  });

  it('opens a part-card sale as a split, and needs a name for a bank transfer', () => {
    const info = sale({ paidBy: 'split', cardAmount: 5, receiptTotal: 20 });
    const choice = initialChoice(info);
    expect(choice.mode).toBe('split');
    expect(partsOf(choice, info, 20)).toMatchObject({ card: 5, cash: 15 });
    const transfer = { ...choice, mode: 'transfer' as const };
    const parts = partsOf(transfer, info, 20);
    expect(refundProblem(en, transfer, parts, 20, false)).toBe(en.refundMoney.nameNeeded);
    expect(refundByInput({ ...transfer, customerName: ' Arben K. ', iban: 'xk05 1212 0123 4567 8906' }, parts, null)).toEqual({
      card: 0,
      transfer: 20,
      tab: 0,
      approvalCode: null,
      customerName: 'Arben K.',
      iban: 'XK051212012345678906',
      batch: null,
    });
  });

  it('refuses typed parts that don’t add up', () => {
    const info = sale({ paidBy: 'cash' });
    const choice = { ...initialChoice(info), mode: 'split' as const, split: { cash: '4', card: '5', transfer: '', tab: '' } };
    expect(refundProblem(en, choice, partsOf(choice, info, 10), 10, false)).toContain('must add up');
  });

  it('knows when the owner must approve first', () => {
    const info = sale({ approval: { limit: 50, tooOld: false } });
    expect(waitsForOwner(info, [30, 30], false)).toBe(false);
    expect(waitsForOwner(info, [60], false)).toBe(true);
    expect(waitsForOwner(info, [5], true)).toBe(true);
    expect(waitsForOwner(sale(), [500], true)).toBe(false);
  });
});
