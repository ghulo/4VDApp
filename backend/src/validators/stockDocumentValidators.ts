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
  lines: z.array(z.object({ productId: idSchema, quantity: quantitySchema(100_000) })).min(1).max(500),
});
