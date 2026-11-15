import { z } from 'zod';
import { calendarDaySchema, idSchema, quantitySchema } from './validate.js';

export const newStockDocumentSchema = z.object({
  direction: z.enum(['in', 'out']),
  reason: z.enum(['found', 'received_free', 'own_use', 'given_away', 'other']),
  day: calendarDaySchema,
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => value || null),
  // expiresOn: a best-before date for the units coming in (stock in only).
  lines: z
    .array(z.object({ productId: idSchema, quantity: quantitySchema(100_000), expiresOn: calendarDaySchema.nullish() }))
    .min(1)
    .max(500),
});
