import { z } from 'zod';
import { EXPENSE_CATEGORIES } from '../constants/expenses.js';
import { exportTimeZoneSchema } from './reportValidators.js';
import { calendarDaySchema, ibanSchema, idSchema, optionalText } from './validate.js';

const money = z.coerce.number().min(0).max(100_000_000);
const positive = money.refine((value) => value > 0, 'must be more than 0');

export const periodSchema = z
  .object({ from: calendarDaySchema, to: calendarDaySchema })
  .refine((period) => period.from <= period.to, { message: 'the first day must come before the last', path: ['from'] });

export const bookExportSchema = z.intersection(periodSchema, z.object({ lang: z.enum(['sq', 'en']).default('sq') }).extend(exportTimeZoneSchema.shape));

export const newPlaceSchema = z
  .object({
    kind: z.enum(['bank', 'safe']),
    name: z.string().trim().min(1, 'give it a name').max(100),
    bankName: optionalText(100),
    iban: ibanSchema.optional().transform((value) => value ?? null),
    openingBalance: z.coerce.number().min(-100_000_000).max(100_000_000).default(0),
    openingDay: calendarDaySchema.nullish().transform((value) => value ?? null),
  })
  .transform((input) => (input.kind === 'safe' ? { ...input, bankName: null, iban: null } : input));

export const placeChangesSchema = z.object({
  name: z.string().trim().max(100).optional(),
  bankName: optionalText(100).optional(),
  iban: ibanSchema.optional(),
  openingBalance: z.coerce.number().min(-100_000_000).max(100_000_000).optional(),
  openingDay: calendarDaySchema.nullish(),
  makeDefault: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const moveSchema = z
  .object({
    day: calendarDaySchema,
    amount: positive,
    /** Null: the owner put the money in. */
    fromPlaceId: idSchema.nullable(),
    /** Null: the owner took the money out. */
    toPlaceId: idSchema.nullable(),
    note: optionalText(500),
  })
  .refine((move) => move.fromPlaceId !== null || move.toPlaceId !== null, { message: 'say where the money comes from or goes to', path: ['fromPlaceId'] });

export const payBillsSchema = z.object({
  supplierId: idSchema,
  placeId: idSchema,
  paidOn: calendarDaySchema,
  note: optionalText(500),
  bills: z
    .array(z.object({ billId: idSchema, amount: positive }))
    .min(1, 'tick at least one bill')
    .max(200),
});

export const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  data: z.string().min(1, 'add the statement file'),
  layout: z
    .object({
      headerRow: z.number().int().min(0).max(200),
      date: z.number().int().min(0).max(100),
      text: z.number().int().min(-1).max(100),
      party: z.number().int().min(0).max(100).nullable(),
      moneyIn: z.number().int().min(0).max(100).nullable(),
      moneyOut: z.number().int().min(0).max(100).nullable(),
      amount: z.number().int().min(0).max(100).nullable(),
      balance: z.number().int().min(0).max(100).nullable(),
      headers: z.array(z.string().max(200)).max(100),
    })
    .refine((layout) => layout.amount !== null || (layout.moneyIn !== null && layout.moneyOut !== null), { message: 'say which column has the money', path: ['amount'] })
    .optional(),
});

export const linesQuerySchema = z.object({ status: z.enum(['open', 'done', 'skipped', 'all']).default('all') });

const allocation = z.object({ documentId: idSchema.nullable(), amount: positive });

export const lineActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('payBills'), supplierId: idSchema, bills: z.array(z.object({ billId: idSchema, amount: positive })).min(1).max(200) }),
  z.object({ kind: z.literal('linkPayment'), paymentId: idSchema }),
  z.object({ kind: z.literal('linkGroup'), groupId: idSchema }),
  z.object({ kind: z.literal('receive'), customerId: idSchema, allocations: z.array(allocation).max(500) }),
  z.object({ kind: z.literal('linkReceipt'), entryId: idSchema }),
  z.object({ kind: z.literal('linkMove'), moveId: idSchema }),
  z.object({ kind: z.literal('move'), otherPlaceId: idSchema.nullable() }),
  z.object({ kind: z.literal('expense'), category: z.enum(EXPENSE_CATEGORIES), supplierId: idSchema.nullable() }),
]);

export const confirmSchema = z.object({
  action: lineActionSchema,
  /** Save a rule so lines with this text do the same from now on. */
  rule: z
    .object({ contains: z.string().trim().min(3, 'at least 3 letters').max(100) })
    .nullish(),
  ruleId: idSchema.nullish(),
});

export const skipSchema = z.object({ skipped: z.boolean() });

export const ruleSchema = z
  .object({
    placeId: idSchema.nullable(),
    contains: z.string().trim().min(3, 'at least 3 letters').max(100),
    direction: z.enum(['in', 'out']),
    action: z.enum(['expense', 'transfer', 'owner']),
    category: z.enum(EXPENSE_CATEGORIES).nullish().transform((value) => value ?? null),
    supplierId: idSchema.nullish().transform((value) => value ?? null),
    otherPlaceId: idSchema.nullish().transform((value) => value ?? null),
  })
  .transform((rule) => ({
    ...rule,
    category: rule.action === 'expense' ? rule.category : null,
    supplierId: rule.action === 'expense' ? rule.supplierId : null,
    otherPlaceId: rule.action === 'transfer' ? rule.otherPlaceId : null,
  }));
