import { z } from 'zod';
import { money } from './catalogValidators.js';
import { SUPPLIER_PAYMENT_METHODS } from '../database/types.js';
import { calendarDaySchema, idSchema, nuiSchema } from './validate.js';

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const supplierSchema = z.object({
  name: z.string().trim().min(1, 'give the supplier a name').max(120),
  nui: nuiSchema,
  phone: optional(40),
  email: z
    .string()
    .trim()
    .email('must be an email address')
    .max(255)
    .nullish()
    .or(z.literal(''))
    .transform((value) => value || null),
  note: optional(500),
});

export const newOrderSchema = z.object({
  supplierId: idSchema,
  note: optional(500),
  lines: z
    .array(
      z.object({
        productId: idSchema,
        quantity: z.number().int().min(1).max(100_000),
        unitCost: money.nullish().transform((value) => value ?? null),
      }),
    )
    .min(1, 'add at least one product')
    .max(200),
});

export const receiveOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: idSchema,
        receivedQuantity: z.number().int().min(0).max(100_000),
        unitCost: money.nullish().transform((value) => value ?? null),
        /** When what came expires, for products that go off. */
        expiresOn: calendarDaySchema.nullish().transform((value) => value ?? null),
      }),
    )
    .max(200),
  updateCostPrices: z.boolean().default(false),
  /** The supplier's bill for this delivery, when it came with one. */
  bill: z.lazy(() => billSchema).optional(),
});

const positiveMoney = money.refine((value) => value > 0, 'must be more than 0');

export const billSchema = z.object({
  number: optional(60),
  issuedOn: calendarDaySchema,
  dueOn: calendarDaySchema.nullish().transform((value) => value ?? null),
  amount: positiveMoney,
  note: optional(500),
});

export const newBillSchema = billSchema.extend({ supplierId: idSchema, orderId: idSchema.nullish() });

export const billQuerySchema = z.object({
  supplierId: z.coerce.number().int().positive().optional(),
  status: z.enum(['open', 'paid', 'void']).optional(),
});

export const paymentSchema = z.object({
  amount: positiveMoney,
  paidOn: calendarDaySchema,
  method: z.enum(SUPPLIER_PAYMENT_METHODS),
  note: optional(500),
});

export const voidBillSchema = z.object({ note: z.string().trim().min(1, 'say why').max(500) });

export const paymentParamsSchema = z.object({ id: idSchema, paymentId: idSchema });
