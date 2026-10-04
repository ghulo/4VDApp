import { z } from 'zod';
import { money } from './catalogValidators.js';

/** A calendar day like "2026-10-04" that really exists (no 31 February). */
export const carwashDayParamsSchema = z.object({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a day like 2026-10-04')
    .refine((value) => new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'must be a real day'),
});

export const carwashTakingsSchema = z.object({
  carwash: money,
  change: money,
});
