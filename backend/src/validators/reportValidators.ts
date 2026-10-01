import { z } from 'zod';
import { endDateQuery, startDateQuery } from './operationsValidators.js';

const MAX_RANGE_DAYS = 366;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const reportRangeSchema = z
  .object({ startDate: startDateQuery, endDate: endDateQuery })
  .refine((range) => range.endDate > range.startDate, { message: 'endDate must be after startDate', path: ['endDate'] })
  // + 1 day: a full year picked as date-only start and end pushes the end to the next midnight.
  .refine((range) => range.endDate.getTime() - range.startDate.getTime() <= (MAX_RANGE_DAYS + 1) * MS_PER_DAY, {
    message: `the range can be at most ${MAX_RANGE_DAYS} days`,
    path: ['endDate'],
  });

export const profitQuerySchema = z.object({
  groupBy: z.enum(['product', 'category']).default('product'),
});
