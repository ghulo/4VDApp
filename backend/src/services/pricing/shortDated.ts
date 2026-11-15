import { roundMoney } from '../../utils/money.js';
import { ValidationError } from '../../errors/httpErrors.js';

/** "This close to the date, this much off": e.g. 2 days or fewer left, 30% off. */
export interface ShortDatedStep {
  days: number;
  percent: number;
}

/** The shop's short-dated rules (Settings). */
export interface ShortDatedRules {
  /** Days before the best-before date stock counts as short-dated, unless its category or product says otherwise. */
  days: number;
  /** Discount steps; the closest step at or above the days left applies. */
  steps: ShortDatedStep[];
  /** Short-dated prices may go below cost. Off: the price stops at cost. */
  belowCost: boolean;
}

export const DEFAULT_SHORT_DATED: ShortDatedRules = {
  days: 3,
  steps: [
    { days: 3, percent: 20 },
    { days: 2, percent: 30 },
    { days: 1, percent: 50 },
  ],
  belowCost: false,
};

/** With no known cost there is nothing to stop at, so the discount stops here instead. */
export const UNKNOWN_COST_MAX_PERCENT = 30;

/** Steps sorted, deduplicated and checked: 1–60 days, 1–90% off, a nearer date never gives less off. */
export function checkSteps(steps: ShortDatedStep[]): ShortDatedStep[] {
  if (steps.length === 0) throw new ValidationError('Add at least one discount step');
  const sorted = [...steps].sort((a, b) => b.days - a.days);
  sorted.forEach((step, i) => {
    const previous = i > 0 ? sorted[i - 1] : undefined;
    if (!Number.isInteger(step.days) || step.days < 0 || step.days > 60) throw new ValidationError('A step’s days must be a whole number from 0 to 60');
    if (!(step.percent > 0 && step.percent <= 90)) throw new ValidationError('A step’s discount must be more than 0% and at most 90%');
    if (previous && previous.days === step.days) throw new ValidationError(`Two steps for ${step.days} days`);
    if (previous && step.percent < previous.percent) throw new ValidationError('A nearer date can’t give a smaller discount');
  });
  return sorted;
}

/** Days before the date that count as short-dated: the product's, else its category's, else the shop's. */
export function shortDatedWindow(productDays: number | null, categoryDays: number | null, rules: ShortDatedRules): number {
  return productDays ?? categoryDays ?? rules.days;
}

/**
 * The discount for stock this many days from its date (0 = the day itself),
 * or null when it isn't short-dated yet or is already past its date.
 * The step for the fewest days that still covers `daysLeft` applies; days
 * inside the window but before the first step get the first step.
 */
export function shortDatedPercent(daysLeft: number, window: number, steps: ShortDatedStep[]): number | null {
  if (daysLeft < 0 || daysLeft > window || steps.length === 0) return null;
  const sorted = [...steps].sort((a, b) => a.days - b.days);
  const step = sorted.find((candidate) => candidate.days >= daysLeft) ?? sorted[sorted.length - 1];
  return step?.percent ?? null;
}

/**
 * The short-dated price for one unit, off the shelf price. It never goes below
 * cost unless the shop allows it; with no known cost the discount is capped
 * at {@link UNKNOWN_COST_MAX_PERCENT}. `percent` is what it really comes to.
 */
export function shortDatedPrice(
  shelfPrice: number,
  percent: number,
  cost: number | null,
  belowCost: boolean,
): { price: number; percent: number } {
  if (shelfPrice <= 0) return { price: shelfPrice, percent: 0 };
  const wanted = cost === null && !belowCost ? Math.min(percent, UNKNOWN_COST_MAX_PERCENT) : percent;
  let price = roundMoney(shelfPrice * (1 - wanted / 100));
  if (!belowCost && cost !== null && price < cost) price = Math.min(shelfPrice, roundMoney(cost));
  return { price, percent: Math.round((1 - price / shelfPrice) * 10000) / 100 };
}

/** Whole days from `today` to `day`, both "YYYY-MM-DD"; negative once it has passed. */
export function daysBetween(today: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
