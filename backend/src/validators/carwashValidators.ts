import { z } from 'zod';
import { money } from './catalogValidators.js';
import { calendarDaySchema, idSchema, trimmedString } from './validate.js';

export const carwashDayParamsSchema = z.object({ day: calendarDaySchema });

/** Which carwash. Left out, it means the only open one; with several it has to be said. */
export const carwashIdQuerySchema = z.object({ carwashId: idSchema.optional() });

export const carwashTakingsSchema = z.object({
  carwashId: idSchema.optional(),
  carwash: money,
  change: money,
});

export const newCarwashSchema = z.object({
  name: trimmedString(80),
  cashFloat: money.default(0),
});

export const updateCarwashSchema = z
  .object({
    name: trimmedString(80).optional(),
    cashFloat: money.optional(),
    archived: z.boolean().optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), { message: 'send at least one of: name, cashFloat, archived' });

export const carwashListQuerySchema = z.object({
  carwashId: idSchema.optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
