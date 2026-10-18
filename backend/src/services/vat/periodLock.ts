import { AppError } from '../../errors/httpErrors.js';
import type { VatMonthRepository } from '../../repositories/VatMonthRepository.js';

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-09-14" → "2026-09-01". */
export const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

/** "2026-09-01" → "September 2026". */
export const monthName = (month: string) => `${MONTHS_EN[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/**
 * Something dated in a VAT month that has been filed. The dashboard shows its
 * own words for the code; `month` says which month.
 */
export class PeriodFiledError extends AppError {
  constructor(readonly month: string) {
    super(`${monthName(month)} is filed with ATK, so nothing dated in it can be added, changed or removed. The accountant can reopen the month if it must change.`, 409, 'PERIOD_FILED');
  }
}

/** Something dated in a year closed in the books. The dashboard shows its own words for the code. */
export class YearClosedError extends AppError {
  constructor(readonly year: number) {
    super(`${year} is closed in the books, so nothing dated in it can be added, changed or removed. The accountant can reopen the year if it must change.`, 409, 'YEAR_CLOSED');
  }
}

/**
 * Refuse when any of these days (yyyy-mm-dd, in the shop's time zone) falls in
 * a filed month or a closed year. Every service that creates, changes or removes something
 * dated (sales, bills, invoices, expenses, counts, hand-written entries) calls
 * this, so the lock holds whichever screen or app the change comes from.
 */
export async function assertMonthsOpen(periods: VatMonthRepository, days: Array<string | null | undefined>): Promise<void> {
  const months = [...new Set(days.filter((day): day is string => Boolean(day)).map(monthOf))];
  const filed = await periods.filedAmong(months);
  if (filed.length > 0) throw new PeriodFiledError(filed.sort()[0]!);
  const closed = await periods.closedYearsAmong([...new Set(months.map((month) => Number(month.slice(0, 4))))]);
  if (closed.length > 0) throw new YearClosedError(Math.min(...closed));
}

/**
 * The VAT month a supplier bill dated `day` counts in. A bill that arrives
 * after its month was filed is not refused: like Odoo's tax lock date, it is
 * counted in the next open month, and the bill says so. Null: its own month.
 *
 * Default until the accountant confirms (handoff.md): the next open month.
 */
export async function vatMonthForBill(periods: VatMonthRepository, day: string): Promise<string | null> {
  const own = monthOf(day);
  const [filed] = await periods.filedAmong([own]);
  return filed ? periods.nextOpenAfter(own) : null;
}
