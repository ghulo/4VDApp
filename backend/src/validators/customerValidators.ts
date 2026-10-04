import { z } from 'zod';
import { money } from './catalogValidators.js';

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'give the customer a name').max(120),
  phone: optional(40),
  note: optional(500),
});

export const tabPaymentSchema = z.object({
  amount: money.refine((value) => value > 0, 'must be more than 0'),
  note: optional(500),
});
