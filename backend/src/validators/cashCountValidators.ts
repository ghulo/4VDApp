import { z } from 'zod';
import { money } from './catalogValidators.js';
import { idSchema } from './validate.js';

export const cashCountSchema = z.object({
  place: z.enum(['shop', 'carwash']),
  /** Which carwash, for a carwash drawer; left out it means the only open one. */
  carwashId: idSchema.optional(),
  /** Everything in the drawer, float included. */
  counted: money,
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => value || null),
}).refine((input) => input.place === 'carwash' || input.carwashId === undefined, {
  message: "the shop's drawer doesn't belong to a carwash",
  path: ['carwashId'],
});
