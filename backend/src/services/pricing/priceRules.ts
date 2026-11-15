import { roundMoney } from '../../utils/money.js';

/**
 * Rounded up to a price people are used to seeing: in 5 cents under €10
 * (1.37 → 1.39, 1.40 → 1.44), in 50 cents under €100 (25.30 → 25.49), else
 * in whole euros (118 → 118.99).
 */
export function nicePrice(amount: number): number {
  const cents = Math.ceil(amount * 100 - 1e-6);
  const step = cents < 1_000 ? 5 : cents < 10_000 ? 50 : 100;
  return (Math.ceil((cents + 1) / step) * step - 1) / 100;
}

/**
 * The mark-up on cost, in percent: what is added on top of what it costs
 * (TREFIN's "Marzha"). Cost 1.00 and price 1.25 is 25%. Null without a cost.
 * The margin that Reports show is the profit's share of the price instead (20% here).
 */
export function markupOf(price: number, cost: number | null): number | null {
  if (cost === null || cost <= 0) return null;
  return Math.round(((price - cost) / cost) * 10_000) / 100;
}

/** A price from the cost and a mark-up in percent, exact to the cent or rounded up to a usual price. */
export function priceFromCost(cost: number, markupPercent: number, rounding: 'exact' | 'nice'): number {
  const exact = cost * (1 + markupPercent / 100);
  return rounding === 'nice' ? nicePrice(exact) : roundMoney(exact);
}
