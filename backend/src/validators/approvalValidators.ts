import { z } from 'zod';
import { trimmedString } from './validate.js';

export const updateSettingsSchema = z
  .object({
    refundApprovalLimit: z.number().min(0).max(100_000).optional(),
    returnWindowDays: z.number().int().min(0).max(3650).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'send refundApprovalLimit, returnWindowDays, or both',
  });

/** Rejecting always needs a reason the employee can read. */
export const decisionNoteSchema = z.object({ note: trimmedString(500) });
