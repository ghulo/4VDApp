import type { RefundInfo } from '../services/types';

/** The ways a refund's money can go back. */
export type RefundMethod = 'cash' | 'card' | 'transfer' | 'tab';
export const REFUND_METHODS: RefundMethod[] = ['cash', 'card', 'transfer', 'tab'];

/** Euros per way, in whole cents so the parts always add up. */
export type RefundParts = Record<RefundMethod, number>;

const cents = (euros: number) => Math.round(euros * 100);
const euros = (amount: number) => amount / 100;

export const noParts = (): RefundParts => ({ cash: 0, card: 0, transfer: 0, tab: 0 });

/**
 * The way the sale was paid, for this refund: all on the card or the tab, all
 * in cash, or (a sale paid part by card) the card's share of it, the rest cash.
 */
export function defaultParts(info: Pick<RefundInfo, 'paidBy' | 'cardAmount' | 'receiptTotal'>, amount: number): RefundParts {
  const parts = noParts();
  if (info.paidBy === 'card') parts.card = amount;
  else if (info.paidBy === 'tab') parts.tab = amount;
  else if (info.paidBy === 'split' && info.cardAmount !== null && info.receiptTotal) {
    const card = euros(Math.min(cents(amount), Math.round((cents(amount) * cents(info.cardAmount)) / cents(info.receiptTotal))));
    parts.card = card;
    parts.cash = euros(cents(amount) - cents(card));
  } else parts.cash = amount;
  return parts;
}

/** The single way when only one has money, else null (a split). */
export function singleMethod(parts: RefundParts): RefundMethod | null {
  const used = REFUND_METHODS.filter((method) => cents(parts[method]) > 0);
  return used.length === 1 ? used[0]! : used.length === 0 ? 'cash' : null;
}

/** Everything going back one way. */
export function allBy(method: RefundMethod, amount: number): RefundParts {
  return { ...noParts(), [method]: amount };
}

export const partsTotal = (parts: RefundParts) => euros(REFUND_METHODS.reduce((sum, method) => sum + cents(parts[method]), 0));

/**
 * Share a refund's parts over the lines given back (one return each), in
 * whole cents: the tab, the card and the transfer fill the lines in order,
 * and what is left on each line is cash. Every line's parts add up to its own
 * refund, and each way adds up over the lines to what was chosen.
 */
export function shareOverLines(lineAmounts: number[], parts: RefundParts): RefundParts[] {
  const left = lineAmounts.map(cents);
  const toShare: Array<[RefundMethod, number]> = [
    ['tab', cents(parts.tab)],
    ['card', cents(parts.card)],
    ['transfer', cents(parts.transfer)],
  ];
  const shares = lineAmounts.map(() => noParts());
  for (const [method, total] of toShare) {
    let remaining = total;
    for (let index = 0; index < left.length && remaining > 0; index += 1) {
      const take = Math.min(left[index]!, remaining);
      shares[index]![method] = euros(take);
      left[index]! -= take;
      remaining -= take;
    }
  }
  left.forEach((rest, index) => {
    shares[index]!.cash = euros(rest);
  });
  return shares;
}
