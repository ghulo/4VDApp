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
