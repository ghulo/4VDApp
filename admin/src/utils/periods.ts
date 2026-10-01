export type PeriodKey = 'this-month' | 'last-month' | 'last-30-days' | 'this-year' | 'custom';

export const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-30-days', label: 'Last 30 days' },
  { key: 'this-year', label: 'This year' },
  { key: 'custom', label: 'Custom dates' },
];

export interface ResolvedPeriod {
  startDate: string;
  endDate: string;
  /** When set, the server compares with exactly this period. */
  previousStartDate?: string;
  previousEndDate?: string;
  label: string;
}

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const dayLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

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

/**
 * Turn a preset into exact instants in the browser's own timezone, so
 * "this month" starts at local midnight on the 1st. End is exclusive.
 * Periods that are still running ("this month", "this year") end now and are
 * compared with the same stretch of the previous month or year.
 */
export function resolvePeriod(key: PeriodKey, custom?: { from: string; to: string }, now: Date = new Date()): ResolvedPeriod {
  const year = now.getFullYear();
  const month = now.getMonth();

  if (key === 'custom' && custom?.from && custom.to) {
    const start = localDay(custom.from);
    const end = new Date(localDay(custom.to).getTime() + MS_PER_DAY);
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      label: `${dayLabel.format(start)} to ${dayLabel.format(localDay(custom.to))}`,
    };
  }

  switch (key) {
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
        label: 'Last 30 days',
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
        label: `${year} so far`,
      };
    }
    default: {
      // "custom" without both dates picked yet also lands here and shows this month.
      const start = new Date(year, month, 1);
      const end = nowToTheMinute(now);
      return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        previousStartDate: new Date(year, month - 1, 1).toISOString(),
        previousEndDate: sameMomentEarlier(end, { months: 1 }, start).toISOString(),
        label: `${monthLabel.format(start)} so far`,
      };
    }
  }
}
