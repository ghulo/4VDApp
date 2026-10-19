import { parseAmount, type Payment } from './CounterSheets';

/** The payment being taken, kept by the Counter so the receipt can show what was paid and the change. */
export interface PayDraft {
  paidBy: Payment['paidBy'];
  tendered: string;
  customerId: string;
  /** Cash + card: the part the bank's terminal takes. */
  card: string;
}

export const EMPTY_PAY: PayDraft = { paidBy: 'cash', tendered: '', customerId: '', card: '' };

const cents = (amount: number) => Math.round(amount * 100) / 100;

/**
 * Cash + card: the card part, and the cash still to take. Null until a card
 * part is typed; `valid` is false when it is nothing or the whole total
 * (all of it on the card is a card sale).
 */
export function splitFor(draft: PayDraft, total: number): { card: number; cashDue: number; valid: boolean } | null {
  if (draft.paidBy !== 'split') return null;
  const card = parseAmount(draft.card);
  if (!Number.isFinite(card)) return null;
  const rounded = cents(card);
  return { card: rounded, cashDue: cents(total - rounded), valid: rounded > 0 && rounded < total };
}

/** The cash to take: the whole total, or what the card leaves. */
export function cashDue(draft: PayDraft, total: number): number {
  return splitFor(draft, total)?.cashDue ?? total;
}

/** What the customer gave in cash and the change; null until an amount is typed. */
export function changeFor(draft: PayDraft, total: number): { given: number; change: number } | null {
  const given = parseAmount(draft.tendered);
  if ((draft.paidBy !== 'cash' && draft.paidBy !== 'split') || !Number.isFinite(given)) return null;
  return { given, change: cents(given - cashDue(draft, total)) };
}
