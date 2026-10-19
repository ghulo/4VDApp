import { z } from 'zod';
import { idSchema } from './validate.js';

const pin = z.string().regex(/^[0-9]{4,6}$/, 'a PIN is 4 to 6 digits');

export const setPinSchema = z.object({
  password: z.string().min(1).max(200),
  /** Null removes the PIN. */
  pin: pin.nullable(),
});

export const pinPeopleQuerySchema = z.object({
  approvers: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
});

export const switchSchema = z.object({ userId: idSchema, pin });

export const rabatApprovalSchema = z.object({
  userId: idSchema,
  pin,
  percent: z.number().positive().max(100).multipleOf(0.01),
  basketId: z.string().min(1).max(64),
});
