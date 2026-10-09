import { z } from 'zod';
import { money } from './catalogValidators.js';
import { nuiSchema } from './validate.js';

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

/** A tab is for a person or a business; a business must give its NUI, a person has none. */
export const customerSchema = z
  .object({
    name: z.string().trim().min(1, 'give the customer a name').max(120),
    kind: z.enum(['person', 'business']).default('person'),
    nui: z.union([nuiSchema, z.literal('').transform(() => null), z.null()]).optional(),
    phone: optional(40),
    note: optional(500),
  })
  .refine((input) => input.kind === 'person' || Boolean(input.nui), { path: ['nui'], message: 'a business needs its NUI' })
  .transform((input) => ({ ...input, nui: input.kind === 'business' ? input.nui! : null }));

export const tabPaymentSchema = z.object({
  amount: money.refine((value) => value > 0, 'must be more than 0'),
  note: optional(500),
});
