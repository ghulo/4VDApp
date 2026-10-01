import { z } from 'zod';
import { MANUAL_STOCK_REASONS } from '../constants/stock.js';
import { booleanQuerySchema, idSchema, optionalText, paginationSchema, trimmedString } from './validate.js';

const MAX_PRICE = 99_999_999.99;
const MAX_STOCK_CHANGE = 1_000_000;
const MAX_TIERS_PER_PRODUCT = 20;

/** Euros with at most two decimals; rounding guards against 0.1 + 0.2 style floats. */
const money = z
  .number()
  .nonnegative()
  .max(MAX_PRICE)
  .transform((value) => Math.round(value * 100) / 100);

const pricingTierSchema = z.object({
  quantity: z.number().int().min(2, 'tier quantity must be at least 2').max(MAX_STOCK_CHANGE),
  price: money,
});

const pricingTiersSchema = z.array(pricingTierSchema).max(MAX_TIERS_PER_PRODUCT);

const optionalImageUrl = z
  .union([z.url({ protocol: /^https?$/ }), z.literal('')])
  .nullish()
  .transform((value) => (value ? value : null));

// ---------- Categories ----------

export const categorySchema = z.object({
  name: trimmedString(100),
  description: optionalText(1000),
});

// ---------- Products ----------

const productFields = {
  name: trimmedString(255),
  description: optionalText(5000),
  categoryId: idSchema,
  price: money,
  costPrice: money.nullish().transform((value) => value ?? null),
  imageUrl: optionalImageUrl,
  sku: optionalText(100),
  isActive: z.boolean().default(true),
  bulkPricingTiers: pricingTiersSchema.optional(),
};

export const createProductSchema = z.object({
  ...productFields,
  stock: z.number().int().min(0).max(MAX_STOCK_CHANGE).default(0),
  reorderLevel: z.number().int().min(0).max(MAX_STOCK_CHANGE).optional(),
});

export const updateProductSchema = z.object({
  ...productFields,
  // Stock changes must go through inventory so they land in the audit trail.
  stock: z
    .undefined({ error: 'stock cannot be changed here, use PATCH /api/inventory/:productId instead' })
    .optional(),
});

export const productQuerySchema = paginationSchema.extend({
  categoryId: idSchema.optional(),
  search: z.string().trim().max(100).optional(),
  inStock: booleanQuerySchema.optional(),
});

// ---------- Inventory ----------

export const inventoryQuerySchema = paginationSchema.extend({
  lowStock: booleanQuerySchema.default(false),
  search: z.string().trim().max(100).optional(),
});

export const stockAdjustmentSchema = z
  .object({
    quantity: z
      .number()
      .int()
      .min(-MAX_STOCK_CHANGE)
      .max(MAX_STOCK_CHANGE)
      .refine((value) => value !== 0, 'quantity cannot be 0')
      .optional(),
    reason: z.enum(MANUAL_STOCK_REASONS).optional(),
    notes: optionalText(1000),
    reorderLevel: z.number().int().min(0).max(MAX_STOCK_CHANGE).optional(),
  })
  .refine((input) => input.quantity !== undefined || input.reorderLevel !== undefined, {
    message: 'send a quantity to change stock, a reorderLevel, or both',
  })
  .refine((input) => input.quantity === undefined || input.reason !== undefined, {
    message: `reason is required when changing stock (one of: ${MANUAL_STOCK_REASONS.join(', ')})`,
    path: ['reason'],
  });

// ---------- Pricing ----------

export const replacePricingTiersSchema = z.object({
  tiers: pricingTiersSchema,
});
