import { parseAmount, type Payment } from './CounterSheets';

/** The payment being taken, kept by the Counter so the receipt can show what was paid and the change. */
export interface PayDraft {
  paidBy: Payment['paidBy'];
  tendered: string;
  customerId: string;
}

export const EMPTY_PAY: PayDraft = { paidBy: 'cash', tendered: '', customerId: '' };

/** What the customer gave and the change; null until an amount is typed. */
export function changeFor(draft: PayDraft, total: number): { given: number; change: number } | null {
  const given = parseAmount(draft.tendered);
  if (draft.paidBy !== 'cash' || !Number.isFinite(given)) return null;
  return { given, change: Math.round((given - total) * 100) / 100 };
}
