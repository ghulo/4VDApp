import { parseAmount, type Payment } from './CounterSheets';

/** The payment being taken, kept by the Counter so the receipt can show what was paid and the change. */
export interface PayDraft {
  paidBy: Payment['paidBy'];
  tendered: string;
  customerId: string;
  /** Cash + card: the part the bank's terminal takes. */
  card: string;
  /** Paying later: the day they promised ("YYYY-MM-DD"); blank is the shop's usual terms. */
  dueDate: string;
}

export const EMPTY_PAY: PayDraft = { paidBy: 'cash', tendered: '', customerId: '', card: '', dueDate: '' };

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

/** A payment half taken when Pay was left (Back, Esc): kept for that basket as long as nothing in it changes. */
export interface KeptPay {
  basketId: string;
  /** What the basket held and cost when the payment was typed (basketSignature). */
  basket: string;
  draft: PayDraft;
}

/** What a payment depends on: the lines, rabat, customer, prices and total. Any change makes a kept payment stale. */
export function basketSignature(
  basket: { lines: ReadonlyArray<{ productId: number; quantity: number; discount?: string; offerPrice?: number }>; discount?: string; customerId?: number | null; wholesale?: boolean | null; offerId?: number | null; delivery?: unknown },
  total: number,
): string {
  return JSON.stringify([
    basket.lines.map((line) => [line.productId, line.quantity, line.discount ?? '', line.offerPrice ?? null]),
    basket.discount ?? '',
    basket.customerId ?? null,
    basket.wholesale ?? null,
    basket.offerId ?? null,
    basket.delivery ?? null,
    cents(total),
  ]);
}

/** The payment Pay opens with: the one kept for this very basket, unchanged since; else a fresh one. */
export function draftToOpen(kept: KeptPay | null, basketId: string, signature: string, fresh: PayDraft): PayDraft {
  return kept && kept.basketId === basketId && kept.basket === signature ? kept.draft : fresh;
}

/**
 * Pay's own keys: F1 cash, F2 card, F3 cash + card, F4 on the tab (not
 * offline). Function keys, never letters or digits: a barcode scanned into Pay
 * types those, and must not change how the customer pays.
 */
export const PAY_KEYS: Readonly<Record<string, PayDraft['paidBy']>> = { F1: 'cash', F2: 'card', F3: 'split', F4: 'tab' };

export function payMethodForKey(key: string, offline: boolean): PayDraft['paidBy'] | null {
  const method = PAY_KEYS[key] ?? null;
  return method === 'tab' && offline ? null : method;
}
