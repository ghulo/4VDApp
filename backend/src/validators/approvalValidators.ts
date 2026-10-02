import { z } from 'zod';
import { APPROVAL_STATUSES, RETURN_CONDITIONS, WRITE_OFF_REASONS } from '../constants/approvals.js';
import { idSchema, optionalText, trimmedString } from './validate.js';

const MAX_UNITS = 1_000_000;

export const approvalListQuerySchema = z.object({ status: z.enum(APPROVAL_STATUSES).optional() });

export const writeOffSchema = z.object({
  productId: idSchema,
  quantity: z.number().int().min(1).max(MAX_UNITS),
  reason: z.enum(WRITE_OFF_REASONS),
  notes: optionalText(1000),
});

export const updateSettingsSchema = z
  .object({
    refundApprovalLimit: z.number().min(0).max(100_000).optional(),
    returnWindowDays: z.number().int().min(0).max(3650).optional(),
    minimumMarginPercent: z.number().min(0).max(1000).optional(),
    dailySummaryHour: z.number().int().min(0).max(23).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'send at least one of: refundApprovalLimit, returnWindowDays, minimumMarginPercent, dailySummaryHour',
  });

/** Rejecting always needs a reason the employee can read. */
export const decisionNoteSchema = z.object({ note: trimmedString(500) });

export const saleIdParamsSchema = z.object({ saleId: idSchema });

export const returnSchema = z.object({
  quantity: z.number().int().min(1).max(MAX_UNITS),
  condition: z.enum(RETURN_CONDITIONS),
  refundAmount: z.number().min(0).max(10_000_000).optional(),
  notes: optionalText(1000),
});

export const startCountSchema = z.object({ categoryId: idSchema.nullish().transform((value) => value ?? null) });

export const countLineParamsSchema = z.object({ id: idSchema, productId: idSchema });

export const countLineSchema = z.object({ countedQuantity: z.number().int().min(0).max(MAX_UNITS) });
