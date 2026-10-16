import { type Catalogue, en } from '../i18n/en';
import { formatDateWith } from './format';

export type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'this-month'
  | 'last-month'
  | 'last-30-days'
  | 'quarter-1'
  | 'quarter-2'
  | 'quarter-3'
  | 'quarter-4'
  | 'this-year'
  | 'last-year'
  | 'custom';

export const PERIOD_KEYS: PeriodKey[] = ['this-month', 'last-month', 'last-30-days', 'this-year', 'custom'];

/** The books' periods: months, this year's quarters (the tax quarters, TM1 to TM4) and whole years. */
export const BOOKS_PERIOD_KEYS: PeriodKey[] = ['this-month', 'last-month', 'quarter-1', 'quarter-2', 'quarter-3', 'quarter-4', 'this-year', 'last-year', 'custom'];

/** "2026-10-04": a date's day on this computer's calendar. */
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** A resolved period as the first and last calendar day it covers, both included (what the books take). */
export function periodDays(range: { startDate: string; endDate: string }): { from: string; to: string } {
  return { from: isoDay(new Date(range.startDate)), to: isoDay(new Date(new Date(range.endDate).getTime() - 1)) };
}

export interface ResolvedPeriod {
  startDate: string;
  endDate: string;
  /** When set, the server compares with exactly this period. */
  previousStartDate?: string;
  previousEndDate?: string;
  label: string;
  /** "Custom dates" is picked but one date is still empty; this month is shown meanwhile. */
  waitingForDates?: true;
}

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** "2026-03-05" read as local midnight (new Date("2026-03-05") would be UTC). */
function localDay(isoDay: string): Date {
  const [year, month, day] = isoDay.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

/**
 * "Now", rounded up to the next whole minute. Ranges that end "now" are used
 * as query keys, so they must not change on every render or the page would
 * refetch in a loop.
 */
function nowToTheMinute(now: Date): Date {
  return new Date(Math.ceil(now.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE);
}

/** The same wall-clock moment shifted back by whole months/years, never past `limit`. */
function sameMomentEarlier(moment: Date, back: { months?: number; years?: number }, limit: Date): Date {
  const shifted = new Date(
    moment.getFullYear() - (back.years ?? 0),
    moment.getMonth() - (back.months ?? 0),
    moment.getDate(),
    moment.getHours(),
    moment.getMinutes(),
  );
  // 31 March minus one month would roll over into March; cap it at the period's end.
  const sameMonth = shifted.getDate() === moment.getDate();
  return !sameMonth || shifted > limit ? limit : shifted;
}

export type CompareKey = 'before' | 'last-year';
export const COMPARE_KEYS: CompareKey[] = ['before', 'last-year'];

/** The same stretch of time one year earlier, for comparing with last year. */
export function lastYearOf(range: { startDate: string; endDate: string }): { previousStartDate: string; previousEndDate: string } {
  const back = (iso: string) => {
    const date = new Date(iso);
    date.setFullYear(date.getFullYear() - 1);
    return date.toISOString();
  };
  return { previousStartDate: back(range.startDate), previousEndDate: back(range.endDate) };
}

/**
 * Turn a preset into exact instants in the browser's own timezone, so
 * "this month" starts at local midnight on the 1st. End is exclusive.
 * Periods that are still running ("this month", "this year") end now and are
 * compared with the same stretch of the previous month or year.
 */
export function resolvePeriod(
  key: PeriodKey,
  custom?: { from: string; to: string },
  now: Date = new Date(),
  t: Catalogue = en,
): ResolvedPeriod {
  const monthLabel = { format: (date: Date) => formatDateWith(date, { month: 'long', year: 'numeric' }) };
  const dayLabel = { format: (date: Date) => formatDateWith(date, { day: 'numeric', month: 'short', year: 'numeric' }) };
  const year = now.getFullYear();
  const month = now.getMonth();

  if (key === 'custom' && custom?.from && custom.to) {
    const start = localDay(custom.from);
    const last = localDay(custom.to);
    // Next local midnight by calendar, not +24h: clock-change days are 23 or 25 hours.
    const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      label: t.periods.range(dayLabel.format(start), dayLabel.format(last)),
    };
  }

  switch (key) {
    case 'today': {
      const start = new Date(year, month, now.getDate());
      const end = nowToTheMinute(now);
      const previousStart = new Date(year, month, now.getDate() - 1);
      return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        previousStartDate: previousStart.toISOString(),
        // Yesterday up to the same time of day.
        previousEndDate: new Date(year, month, now.getDate() - 1, end.getHours(), end.getMinutes()).toISOString(),
        label: t.periods.options.today,
      };
    }
    case 'yesterday': {
      const start = new Date(year, month, now.getDate() - 1);
      return {
        startDate: start.toISOString(),
        endDate: new Date(year, month, now.getDate()).toISOString(),
        previousStartDate: new Date(year, month, now.getDate() - 2).toISOString(),
        previousEndDate: start.toISOString(),
        label: t.periods.options.yesterday,
      };
    }
    case 'this-week': {
      // Weeks start on Monday.
      const monday = now.getDate() - ((now.getDay() + 6) % 7);
      const start = new Date(year, month, monday);
      const end = nowToTheMinute(now);
      const previousStart = new Date(year, month, monday - 7);
      const sameTimeLastWeek = new Date(year, month, end.getDate() - 7, end.getHours(), end.getMinutes());
      return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        previousStartDate: previousStart.toISOString(),
        previousEndDate: (sameTimeLastWeek > start ? start : sameTimeLastWeek).toISOString(),
        label: t.periods.options['this-week'],
      };
    }
    case 'last-month': {
      const start = new Date(year, month - 1, 1);
      return {
        startDate: start.toISOString(),
        endDate: new Date(year, month, 1).toISOString(),
        previousStartDate: new Date(year, month - 2, 1).toISOString(),
        previousEndDate: start.toISOString(),
        label: monthLabel.format(start),
      };
    }
    case 'last-30-days': {
      const end = nowToTheMinute(now);
      return {
        startDate: new Date(end.getTime() - 30 * MS_PER_DAY).toISOString(),
        endDate: end.toISOString(),
        label: t.periods.options['last-30-days'],
      };
    }
    case 'this-year': {
      const start = new Date(year, 0, 1);
      const end = nowToTheMinute(now);
      const previousStart = new Date(year - 1, 0, 1);
      return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        previousStartDate: previousStart.toISOString(),
        previousEndDate: sameMomentEarlier(end, { years: 1 }, start).toISOString(),
        label: t.periods.soFar(String(year)),
      };
    }
    case 'last-year': {
      const start = new Date(year - 1, 0, 1);
      return {
        startDate: start.toISOString(),
        endDate: new Date(year, 0, 1).toISOString(),
        previousStartDate: new Date(year - 2, 0, 1).toISOString(),
        previousEndDate: start.toISOString(),
        label: String(year - 1),
      };
    }
    case 'quarter-1':
    case 'quarter-2':
    case 'quarter-3':
    case 'quarter-4': {
      const quarter = Number(key.slice(-1));
      const start = new Date(year, (quarter - 1) * 3, 1);
      const end = new Date(year, quarter * 3, 1);
      return {
        startDate: start.toISOString(),
        // A quarter still running ends now, like this month does.
        endDate: (start <= now && end > now ? nowToTheMinute(now) : end).toISOString(),
        previousStartDate: new Date(year, (quarter - 2) * 3, 1).toISOString(),
        previousEndDate: start.toISOString(),
        label: t.periods.quarter(quarter, year),
      };
    }
    default: {
      // "custom" without both dates picked yet also lands here and shows this month.
      const waitingForDates = key === 'custom' ? ({ waitingForDates: true } as const) : {};
      const start = new Date(year, month, 1);
      const end = nowToTheMinute(now);
      return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        previousStartDate: new Date(year, month - 1, 1).toISOString(),
        previousEndDate: sameMomentEarlier(end, { months: 1 }, start).toISOString(),
        label: t.periods.soFar(monthLabel.format(start)),
        ...waitingForDates,
      };
    }
  }
}
