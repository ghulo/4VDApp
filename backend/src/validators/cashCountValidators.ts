import { z } from 'zod';
import { money } from './catalogValidators.js';

export const cashCountSchema = z.object({
  place: z.enum(['shop', 'carwash']),
  /** Everything in the drawer, float included. */
  counted: money,
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => value || null),
});
