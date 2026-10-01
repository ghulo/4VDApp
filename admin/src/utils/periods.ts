export type PeriodKey = 'this-month' | 'last-month' | 'last-30-days' | 'this-year' | 'custom';

export const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-30-days', label: 'Last 30 days' },
  { key: 'this-year', label: 'This year' },
  { key: 'custom', label: 'Custom dates' },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const dayLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "2026-03-05" read as local midnight (new Date("2026-03-05") would be UTC). */
function localDay(isoDay: string): Date {
  const [year, month, day] = isoDay.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

/**
 * Turn a preset into exact instants in the browser's own timezone, so
 * "this month" starts at local midnight on the 1st. End is exclusive.
 */
export function resolvePeriod(
  key: PeriodKey,
  custom?: { from: string; to: string },
  now: Date = new Date(),
): { startDate: string; endDate: string; label: string } {
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

  let start: Date;
  let end: Date;
  let label: string;
  // "custom" without both dates picked yet shows this month.
  switch (key) {
    case 'last-month':
      start = new Date(year, month - 1, 1);
      end = new Date(year, month, 1);
      label = monthLabel.format(start);
      break;
    case 'last-30-days':
      end = now;
      start = new Date(now.getTime() - 30 * MS_PER_DAY);
      label = 'Last 30 days';
      break;
    case 'this-year':
      start = new Date(year, 0, 1);
      end = new Date(year + 1, 0, 1);
      label = String(year);
      break;
    default:
      start = new Date(year, month, 1);
      end = new Date(year, month + 1, 1);
      label = monthLabel.format(start);
  }
  return { startDate: start.toISOString(), endDate: end.toISOString(), label };
}
