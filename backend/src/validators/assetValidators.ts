import { z } from 'zod';
import { calendarDaySchema, idSchema, optionalText, trimmedString } from './validate.js';

const money = z.number().min(0).max(100_000_000).multipleOf(0.01, 'an amount has at most two decimals');
const category = z.enum(['furniture', 'equipment', 'vehicle', 'building', 'land', 'intangible', 'other']);
const rate = z.number().min(0).max(100).multipleOf(0.01, 'a rate has at most two decimals');

export const newAssetSchema = z.object({
  name: trimmedString(200),
  code: optionalText(60),
  category,
  boughtOn: calendarDaySchema,
  inUseFrom: calendarDaySchema,
  cost: money.positive(),
  residual: money.default(0),
  rate: rate.nullish().transform((value) => value ?? null),
  openingDepreciated: money.nullish().transform((value) => value ?? null),
  place: z.enum(['shop', 'carwash']).default('shop'),
  note: optionalText(500),
});

export const assetChangesSchema = z
  .object({
    name: trimmedString(200),
    code: optionalText(60),
    category,
    boughtOn: calendarDaySchema,
    inUseFrom: calendarDaySchema,
    cost: money.positive(),
    residual: money,
    rate,
    openingDepreciated: money,
    note: optionalText(500),
  })
  .partial();

export const openingQuerySchema = z.object({
  category,
  cost: z.coerce.number().positive(),
  residual: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).max(100).optional(),
  inUseFrom: calendarDaySchema,
});

export const splitSchema = z.object({ pieces: z.number().int().min(2).max(100) });

export const disposeSchema = z.object({
  kind: z.enum(['sold', 'scrapped']),
  day: calendarDaySchema,
  amount: money.nullish().transform((value) => value ?? null),
  vatRate: z
    .union([z.literal(0), z.literal(8), z.literal(18)])
    .nullish()
    .transform((value) => value ?? null),
  buyerName: optionalText(200),
  buyerNui: optionalText(40),
  customerId: idSchema.nullish().transform((value) => value ?? null),
  paidPlaceId: idSchema.nullish().transform((value) => value ?? null),
  note: optionalText(500),
});

export const yearParamsSchema = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
