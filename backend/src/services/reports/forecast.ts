/**
 * Run-out forecasts that follow busy and quiet periods.
 *
 * - Looks at the last 8 weeks of sales, or since the product was added.
 * - The last 2 weeks count double, so a product picking up (or slowing down)
 *   moves the forecast quickly without one odd day taking over.
 * - With enough history, each day of the week gets its own weight, so a
 *   shop that sells most on Saturdays runs out on a Saturday, not mid-week.
 */

export const FORECAST_HISTORY_DAYS = 56;
const RECENT_DAYS = 14;
/** Shorter histories are stretched to a week so one sale on day one doesn't predict a flood. */
const MIN_HISTORY_DAYS = 7;
/** Day-of-week weights need at least 4 of each weekday and some sales to be meaningful. */
const MIN_DAYS_FOR_WEEKDAYS = 28;
const MIN_UNITS_FOR_WEEKDAYS = 14;
const ORDER_FOR_DAYS = 30;
/** Further out than a year is "not soon"; stop counting. */
const MAX_FORECAST_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type Trend = 'rising' | 'falling' | 'steady';

export interface ForecastInput {
  /** Sales of this one product, any order. Only the last 8 weeks are used. */
  sales: Array<{ at: Date; units: number }>;
  now: Date;
  /** When the product was added; days before it don't count as "no sales". */
  availableSince: Date;
  stock: number;
  reorderLevel: number;
  /** The shop's time zone, for days of the week. */
  timeZone: string;
}

export interface Forecast {
  /** Expected units a day, before the day-of-week weights. */
  averageDailySales: number;
  /** Whole days the current stock covers; null when nothing is selling. */
  daysLeft: number | null;
  /** Enough for the next 30 days plus the reorder buffer. */
  suggestedOrder: number;
  /** The last 2 weeks against the 6 before them; null without enough history to say. */
  trend: Trend | null;
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 0 = Sunday, in `timeZone`. */
export function weekdayIn(date: Date, timeZone: string): number {
  let formatter = weekdayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone });
    weekdayFormatters.set(timeZone, formatter);
  }
  return WEEKDAYS.indexOf(formatter.format(date));
}

export function forecast(input: ForecastInput): Forecast {
  const now = input.now.getTime();
  const windowStart = Math.max(now - FORECAST_HISTORY_DAYS * MS_PER_DAY, input.availableSince.getTime());
  const historyDays = Math.max(MIN_HISTORY_DAYS, (now - windowStart) / MS_PER_DAY);
  const recentDays = Math.min(RECENT_DAYS, historyDays);
  const olderDays = historyDays - recentDays;
  const recentStart = now - recentDays * MS_PER_DAY;

  const inWindow = input.sales.filter((sale) => sale.at.getTime() >= windowStart && sale.at.getTime() <= now);
  const recentUnits = sum(inWindow.filter((sale) => sale.at.getTime() >= recentStart).map((sale) => sale.units));
  const totalUnits = sum(inWindow.map((sale) => sale.units));
  const recentRate = recentUnits / recentDays;
  const olderRate = olderDays > 0 ? (totalUnits - recentUnits) / olderDays : 0;
  // Recent days weigh double, once there's an older stretch worth comparing with.
  const rate = olderDays >= MIN_HISTORY_DAYS ? (2 * recentRate + olderRate) / 3 : totalUnits / historyDays;

  const weights =
    historyDays >= MIN_DAYS_FOR_WEEKDAYS && totalUnits >= MIN_UNITS_FOR_WEEKDAYS
      ? weekdayWeights(inWindow, windowStart, historyDays, input.timeZone)
      : null;
  const demandOn = (dayOffset: number) =>
    rate * (weights ? weights[weekdayIn(new Date(now + dayOffset * MS_PER_DAY), input.timeZone)]! : 1);

  return {
    averageDailySales: round(rate, 2),
    daysLeft: rate === 0 ? null : daysCovered(input.stock, demandOn),
    suggestedOrder: Math.max(
      0,
      Math.ceil(sum(Array.from({ length: ORDER_FOR_DAYS }, (_, day) => demandOn(day))) + input.reorderLevel - input.stock),
    ),
    trend: olderDays >= RECENT_DAYS ? trendOf(recentRate, olderRate) : null,
  };
}

/** How much busier each weekday is than average; they average to 1. */
function weekdayWeights(
  sales: Array<{ at: Date; units: number }>,
  windowStart: number,
  historyDays: number,
  timeZone: string,
): number[] {
  const unitsByWeekday = Array<number>(7).fill(0);
  for (const sale of sales) unitsByWeekday[weekdayIn(sale.at, timeZone)]! += sale.units;

  const daysByWeekday = Array<number>(7).fill(0);
  for (let day = 0; day < Math.floor(historyDays); day++) {
    daysByWeekday[weekdayIn(new Date(windowStart + day * MS_PER_DAY), timeZone)]! += 1;
  }

  const overall = sum(unitsByWeekday) / historyDays;
  // Clamped so a weekday with no sales yet still gets a little demand.
  const raw = unitsByWeekday.map((units, weekday) => Math.min(3, Math.max(0.2, units / Math.max(1, daysByWeekday[weekday]!) / overall)));
  const mean = sum(raw) / 7;
  return raw.map((weight) => weight / mean);
}

function daysCovered(stock: number, demandOn: (dayOffset: number) => number): number {
  let remaining = stock;
  for (let day = 0; day < MAX_FORECAST_DAYS; day++) {
    const demand = demandOn(day);
    // A hair of tolerance so 15 units at 0.5 a day lasts the full 30 days.
    if (remaining + 1e-9 < demand) return day;
    remaining -= demand;
  }
  return MAX_FORECAST_DAYS;
}

function trendOf(recentRate: number, olderRate: number): Trend {
  if (olderRate === 0) return recentRate > 0 ? 'rising' : 'steady';
  const ratio = recentRate / olderRate;
  if (ratio >= 1.25) return 'rising';
  if (ratio <= 0.8) return 'falling';
  return 'steady';
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
