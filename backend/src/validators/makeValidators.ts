import { z } from 'zod';
import { calendarDaySchema, idSchema } from './validate.js';

const quantity = z.number().positive('must be more than 0').max(100_000);

export const recipeSchema = z.object({
  parts: z.array(z.object({ productId: idSchema, quantity })).max(50),
});

export const makePlanSchema = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive().max(100_000),
  locationId: z.coerce.number().int().positive().optional(),
});

export const newMakeSchema = z.object({
  productId: idSchema,
  quantity,
  day: calendarDaySchema,
  locationId: idSchema.nullish(),
  expiresOn: calendarDaySchema.nullish(),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => value || null),
});
