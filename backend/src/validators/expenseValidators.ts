import { z } from 'zod';
import { EXPENSE_CATEGORIES, EXPENSE_PLACES } from '../constants/expenses.js';
import { money } from './catalogValidators.js';
import { calendarDaySchema } from './validate.js';

export const newExpenseSchema = z.object({
  day: calendarDaySchema,
  amount: money.refine((value) => value > 0, 'must be more than 0'),
  category: z.enum(EXPENSE_CATEGORIES),
  place: z.enum(EXPENSE_PLACES),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => value || null),
  repeatMonthly: z.boolean().default(false),
});
