import { z } from 'zod';
import { endDateQuery, startDateQuery } from './operationsValidators.js';

const MAX_RANGE_DAYS = 366;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A full year of dates (e.g. 1 Jan to 1 Jan, end pushed to the next midnight)
// is 366 days, or 367 only across a leap day, so no extra allowance is needed.
const isWithinMaxRange = (start: Date, end: Date) => end.getTime() - start.getTime() <= MAX_RANGE_DAYS * MS_PER_DAY;

export const reportRangeSchema = z
  .object({
    startDate: startDateQuery,
    endDate: endDateQuery,
    // Optional explicit comparison period, e.g. "the same days last month" or
    // "last calendar month". Without it the server uses the same length of
    // time immediately before.
    previousStartDate: startDateQuery.optional(),
    previousEndDate: endDateQuery.optional(),
  })
  .refine((range) => range.endDate > range.startDate, { message: 'endDate must be after startDate', path: ['endDate'] })
  .refine((range) => isWithinMaxRange(range.startDate, range.endDate), {
    message: `the range can be at most ${MAX_RANGE_DAYS} days`,
    path: ['endDate'],
  })
  .refine((range) => (range.previousStartDate === undefined) === (range.previousEndDate === undefined), {
    message: 'send both previousStartDate and previousEndDate, or neither',
    path: ['previousEndDate'],
  })
  .refine(
    (range) =>
      !range.previousStartDate ||
      !range.previousEndDate ||
      (range.previousEndDate > range.previousStartDate &&
        isWithinMaxRange(range.previousStartDate, range.previousEndDate)),
    { message: `previousEndDate must be after previousStartDate, at most ${MAX_RANGE_DAYS} days`, path: ['previousEndDate'] },
  )
  .transform(({ startDate, endDate, previousStartDate, previousEndDate }) => ({
    startDate,
    endDate,
    previous: previousStartDate && previousEndDate ? { startDate: previousStartDate, endDate: previousEndDate } : undefined,
  }));

export const profitQuerySchema = z.object({
  groupBy: z.enum(['product', 'category']).default('product'),
});

function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The admin's IANA timezone (e.g. Europe/Dublin), used to name files and write dates in exports. */
export const exportTimeZoneSchema = z.object({
  tz: z.string().max(64).refine(isKnownTimeZone, 'tz must be a timezone like Europe/Dublin').default('UTC'),
});

export const askAssistantSchema = z.object({
  question: z.string().trim().min(3, 'ask a question').max(500, 'keep the question under 500 characters'),
});
