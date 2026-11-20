import { z } from 'zod';
import { APPROVAL_STATUSES, RETURN_CONDITIONS, WRITE_OFF_REASONS } from '../constants/approvals.js';
import { WIPE_PHRASE } from '../scripts/wipeShopData.js';
import { calendarDaySchema, idSchema, optionalText, quantitySchema, stockLevelSchema, trimmedString } from './validate.js';

const MAX_UNITS = 1_000_000;

export const approvalListQuerySchema = z.object({ status: z.enum(APPROVAL_STATUSES).optional() });

export const writeOffSchema = z.object({
  locationId: idSchema.nullish(),
  productId: idSchema,
  quantity: quantitySchema(MAX_UNITS),
  reason: z.enum(WRITE_OFF_REASONS),
  notes: optionalText(1000),
  projectId: idSchema.nullish(),
});

export const updateSettingsSchema = z
  .object({
    refundApprovalLimit: z.number().min(0).max(100_000).optional(),
    returnWindowDays: z.number().int().min(0).max(3650).optional(),
    minimumMarginPercent: z.number().min(0).max(1000).optional(),
    cashFloatShop: z.number().min(0).max(100_000).optional(),
    paymentTermsDays: z.number().int().min(0).max(365).optional(),
    employeeDiscountLimit: z.number().min(0).max(100).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'send at least one of: refundApprovalLimit, returnWindowDays, minimumMarginPercent, cashFloatShop, paymentTermsDays, employeeDiscountLimit',
  });

const numberFormatSchema = z.object({
  prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, 'use 1 to 6 letters or digits'),
  year: z.enum(['yy', 'yyyy']),
  digits: z.number().int().min(3).max(8),
});

export const updateRulesSchema = z
  .object({
    numbering: z
      .object({ invoice: numberFormatSchema, credit_note: numberFormatSchema, offer: numberFormatSchema, stock_in: numberFormatSchema, stock_out: numberFormatSchema, stock_move: numberFormatSchema, make: numberFormatSchema })
      .partial()
      .optional(),
    noStockSales: z.enum(['block', 'allow']).optional(),
    shortDated: z
      .object({
        days: z.number().int().min(1).max(60),
        steps: z.array(z.object({ days: z.number().int().min(0).max(60), percent: z.number().gt(0).max(90) })).min(1).max(10),
        belowCost: z.boolean(),
      })
      .partial()
      .optional(),
    features: z.object({ projects: z.boolean(), recipes: z.boolean(), serials: z.boolean() }).partial().optional(),
  })
  .refine((input) => input.numbering !== undefined || input.noStockSales !== undefined || input.shortDated !== undefined || input.features !== undefined, {
    message: 'send numbering, noStockSales, shortDated or features',
  });

/** Wiping everything has to be typed out, so it can't happen by a stray click. */
export const wipeSchema = z.object({
  confirm: z.literal(WIPE_PHRASE, { error: `type "${WIPE_PHRASE}" to confirm` }),
});

/** Rejecting always needs a reason the employee can read. */
export const decisionNoteSchema = z.object({ note: trimmedString(500) });

export const saleIdParamsSchema = z.object({ saleId: idSchema });

export const returnSchema = z.object({
  quantity: quantitySchema(MAX_UNITS),
  condition: z.enum(RETURN_CONDITIONS),
  refundAmount: z.number().min(0).max(10_000_000).optional(),
  notes: optionalText(1000),
  /** How the money goes back; left out, it all comes out of the till (less a tab), as before. */
  refundBy: z
    .object({
      card: z.number().min(0).max(10_000_000).default(0),
      transfer: z.number().min(0).max(10_000_000).default(0),
      tab: z.number().min(0).max(10_000_000).nullish().transform((value) => value ?? null),
      approvalCode: optionalText(40),
      customerName: optionalText(200),
      iban: optionalText(40),
      batch: z.uuid().nullish().transform((value) => value ?? null),
    })
    .optional(),
});

export const refundInfoQuerySchema = z.object({ saleId: z.coerce.number().int().positive() });

export const refundsSentSchema = z.object({
  returnIds: z.array(z.number().int().positive()).min(1).max(200),
  placeId: z.number().int().positive(),
  day: calendarDaySchema,
});

export const startCountSchema = z.object({ categoryId: idSchema.nullish().transform((value) => value ?? null), locationId: idSchema.nullish().transform((value) => value ?? null) });

export const countLineParamsSchema = z.object({ id: idSchema, productId: idSchema });

export const countLineSchema = z.object({ countedQuantity: stockLevelSchema(MAX_UNITS) });
