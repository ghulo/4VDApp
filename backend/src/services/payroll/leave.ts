/**
 * Annual leave. Kosovo's Labour Law (No. 03/L-212, Art. 32) gives at least 20
 * working days of paid leave a year, plus one more day for each full five
 * years of service (Payoneer and Remote leave guides; the extra day is not
 * confirmed from the law's text: accountant question in handoff.md). 4VD
 * earns it month by month, a twelfth of the year's days for each whole month
 * worked, so a new starter or a leaver gets their share. Days not taken carry
 * on in the balance (the law's carry-over limit is an accountant question).
 */

const round1 = (value: number) => Math.round(value * 10) / 10;

const addMonths = (day: string, months: number): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

/** Full years between two days. */
export function yearsOfService(startedOn: string, on: string): number {
  let years = Number(on.slice(0, 4)) - Number(startedOn.slice(0, 4));
  if (on.slice(5) < startedOn.slice(5)) years -= 1;
  return Math.max(0, years);
}

/** The year's leave days on a day: the contract's days plus one for each full five years. */
export function yearlyDays(baseDays: number, startedOn: string, on: string): number {
  return baseDays + Math.floor(yearsOfService(startedOn, on) / 5);
}

/** Days earned from the first day of work up to a day (or the day they left, if earlier). */
export function earnedDays(baseDays: number, startedOn: string, leftOn: string | null, upTo: string): number {
  const end = leftOn && leftOn < upTo ? leftOn : upTo;
  let earned = 0;
  // Each whole month worked: the month from the start day to the day before the same date next month.
  for (let months = 1; months <= 1200; months += 1) {
    const lastDay = addDays(addMonths(startedOn, months), -1);
    if (lastDay > end) break;
    earned += yearlyDays(baseDays, startedOn, lastDay) / 12;
  }
  return round1(earned);
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Working days from one day to another, Monday to Friday, both included: a starting figure the person can change. */
export function workingDays(from: string, to: string): number {
  let count = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    if (count > 400) break;
  }
  return count;
}

export interface LeaveBalance {
  /** The year's days now (the contract's days plus the years-of-service days). */
  yearly: number;
  earned: number;
  taken: number;
  /** Corrections: an opening balance, days paid out (negative) or days given. */
  adjusted: number;
  balance: number;
}

export function leaveBalance(
  employee: { leaveDays: number; startedOn: string; leftOn: string | null },
  entries: Array<{ kind: 'taken' | 'adjust'; days: number }>,
  on: string,
): LeaveBalance {
  const earned = earnedDays(employee.leaveDays, employee.startedOn, employee.leftOn, on);
  const taken = round1(entries.filter((entry) => entry.kind === 'taken').reduce((sum, entry) => sum + entry.days, 0));
  const adjusted = round1(entries.filter((entry) => entry.kind === 'adjust').reduce((sum, entry) => sum + entry.days, 0));
  return {
    yearly: yearlyDays(employee.leaveDays, employee.startedOn, employee.leftOn && employee.leftOn < on ? employee.leftOn : on),
    earned,
    taken,
    adjusted,
    balance: round1(earned + adjusted - taken),
  };
}
