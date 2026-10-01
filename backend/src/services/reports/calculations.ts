export const REORDER_WINDOW_DAYS = 30;

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/** 0.25 means +25%. Null when the previous value was 0, since any change from 0 is infinite. */
export function relativeChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  // Divide by the size of the baseline so going from a loss to a profit reads as a rise.
  return round((current - previous) / Math.abs(previous), 4);
}

/** The same length of time, immediately before `range`. */
export function previousRange(range: DateRange): DateRange {
  const length = range.endDate.getTime() - range.startDate.getTime();
  return { startDate: new Date(range.startDate.getTime() - length), endDate: range.startDate };
}

export function margin(profit: number, revenueWithKnownCost: number): number | null {
  if (revenueWithKnownCost === 0) return null;
  return round(profit / revenueWithKnownCost, 4);
}

/**
 * Based on the last 30 days of sales: how long current stock lasts, and how
 * many to order so there's enough for the next 30 days plus the reorder buffer.
 */
export function reorderSuggestion(input: { unitsSoldLast30Days: number; quantity: number; reorderLevel: number }) {
  const perDay = input.unitsSoldLast30Days / REORDER_WINDOW_DAYS;
  const neededForWindow = perDay * REORDER_WINDOW_DAYS;
  return {
    averageDailySales: round(perDay, 2),
    daysLeft: perDay === 0 ? null : Math.floor(input.quantity / perDay),
    suggestedOrder: Math.max(0, Math.ceil(neededForWindow + input.reorderLevel - input.quantity)),
  };
}
