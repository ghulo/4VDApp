import { z } from 'zod';
import { LANGUAGES } from '../i18n/language.js';
import { endDateQuery, startDateQuery } from './operationsValidators.js';
import { paginationSchema } from './validate.js';

export const documentQuerySchema = paginationSchema.extend({
  kind: z.enum(['invoice', 'credit_note']).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  startDate: startDateQuery.optional(),
  endDate: endDateQuery.optional(),
});

/** The printed page's language; defaults to the reader's own. */
export const documentPrintQuerySchema = z.object({ language: z.enum(LANGUAGES).optional() });

export const fiscalReceiptSchema = z.object({
  /** The number on the fiscal printer's receipt; empty or null removes it. */
  fiscalReceiptNo: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .transform((value) => (value ? value : null)),
});
