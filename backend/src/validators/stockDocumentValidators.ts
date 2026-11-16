import { z } from 'zod';
import { calendarDaySchema, idSchema, quantitySchema } from './validate.js';

export const newStockDocumentSchema = z.object({
  locationId: idSchema.nullish(),
  projectId: idSchema.nullish(),
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

export const newStockMoveSchema = z.object({
  fromId: idSchema,
  toId: idSchema,
  day: calendarDaySchema,
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => value || null),
  lines: z
    .array(z.object({ productId: idSchema, quantity: quantitySchema(100_000) }))
    .min(1)
    .max(500),
});

const locationName = z.string().trim().min(1, 'give it a name').max(60);

export const newLocationSchema = z.object({ name: locationName });

export const updateLocationSchema = z
  .object({ name: locationName.optional(), sellsHere: z.literal(true).optional(), receivesHere: z.literal(true).optional() })
  .refine((value) => Object.keys(value).length > 0, 'change at least one thing');

export const shelfMinimumSchema = z.object({
  locationId: idSchema,
  minimum: z.number().min(0).max(100_000).multipleOf(0.001).nullable(),
});
