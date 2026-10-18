import { z } from 'zod';
import { periodSchema } from './moneyValidators.js';
import { idSchema, optionalText, trimmedString } from './validate.js';

/** The printer's tax group for one VAT rate (Datecs groups 1-8); null when not set yet. */
const taxGroup = z.number().int().min(1).max(8).nullable();

export const counterSettingsSchema = z.object({
  receiptFooter: z.string().trim().max(80),
  printer: z.object({
    enabled: z.boolean(),
    taxGroups: z.object({ '18': taxGroup, '16': taxGroup, '8': taxGroup, '0': taxGroup }),
  }),
  drawerConnected: z.boolean(),
});

const withReason = trimmedString(200);

/** What happened at the counter; a line, basket or drawer always says why. */
const eventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('line_removed'), productId: idSchema, quantity: z.number().int().min(1).max(1_000_000), amount: z.number().min(0), reason: withReason }),
  z.object({ kind: z.literal('basket_cancelled'), amount: z.number().min(0), quantity: z.number().int().min(1).max(1_000_000), reason: withReason }),
  z.object({ kind: z.literal('drawer_opened'), reason: withReason }),
  z.object({ kind: z.literal('print_failed'), documentId: idSchema.optional(), reason: optionalText(200) }),
  z.object({ kind: z.literal('reprinted'), documentId: idSchema }),
  z.object({ kind: z.literal('x_report') }),
  z.object({ kind: z.literal('z_report') }),
]);

export const counterEventsSchema = z.object({ events: z.array(eventSchema).min(1).max(50) });

export const counterReportSchema = periodSchema;

export const counterEventsQuerySchema = z.intersection(periodSchema, z.object({ userId: idSchema.optional() }));

export type CounterSettingsInput = z.output<typeof counterSettingsSchema>;
export type CounterEventInput = z.output<typeof eventSchema>;
