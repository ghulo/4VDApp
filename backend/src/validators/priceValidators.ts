import { z } from 'zod';
import { idSchema } from './validate.js';

const amount = z.number().min(0).max(10_000_000).multipleOf(0.01);

const changeSchema = z.object({
  productId: idSchema,
  price: amount.optional(),
  wholesalePrice: amount.nullable().optional(),
  costPrice: amount.nullable().optional(),
});

export const priceChangesSchema = z.object({
  changes: z.array(changeSchema).min(1, 'change at least one price').max(5_000),
});

export const applyPricesSchema = priceChangesSchema.extend({
  source: z.enum(['editor', 'excel', 'fromCost']).default('editor'),
});

export const fromCostSchema = z.object({
  productIds: z.array(idSchema).max(5_000).optional(),
  categoryId: idSchema.optional(),
  level: z.enum(['shelf', 'wholesale']),
  markupPercent: z.number().min(0).max(1_000),
  rounding: z.enum(['exact', 'nice']).default('nice'),
});

export const priceFileSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  data: z.string().min(1, 'add the price file'),
});
