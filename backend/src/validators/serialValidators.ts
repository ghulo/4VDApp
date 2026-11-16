import { z } from 'zod';
import { idSchema } from './validate.js';

export const serialProductSchema = z.object({
  hasSerials: z.boolean(),
  warrantyMonths: z.number().int().min(0).max(120).nullable(),
});

export const addSerialsSchema = z.object({
  productId: idSchema,
  serials: z.array(z.string().trim().min(1).max(80)).min(1, 'type or scan at least one serial number').max(1000),
  billId: idSchema.nullish(),
  stockDocumentId: idSchema.nullish(),
  orderId: idSchema.nullish(),
});

export const serialSearchSchema = z.object({ q: z.string().trim().min(2, 'type at least 2 characters').max(80) });
