import { z } from 'zod';
import { calendarDaySchema, idSchema, optionalText, trimmedString } from './validate.js';

const money = z.number().min(0).max(1_000_000).multipleOf(0.01, 'an amount has at most two decimals');
const extra = z.number().min(0).max(10).multipleOf(0.01, 'a rate has at most two decimals');

export const employeeSchema = z.object({
  userId: idSchema.nullish().transform((value) => value ?? null),
  name: trimmedString(200),
  // Kosovo personal numbers have 10 digits; kept as typed so older formats still fit.
  personalNumber: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9 ]*$/, 'a personal number is digits only')
    .nullish()
    .transform((value) => (value ? value.replace(/ /g, '') : null)),
  jobTitle: optionalText(120),
  contract: z.enum(['open', 'fixed', 'part_time']),
  startedOn: calendarDaySchema,
  contractEndsOn: calendarDaySchema.nullish().transform((value) => value ?? null),
  leftOn: calendarDaySchema.nullish().transform((value) => value ?? null),
  payBasis: z.enum(['gross', 'net']),
  payAmount: money,
  secondary: z.boolean().default(false),
  nonResident: z.boolean().default(false),
  extraPensionEmployee: extra.default(0),
  extraPensionEmployer: extra.default(0),
  bankAccount: optionalText(40),
  bankName: optionalText(80),
  phone: optionalText(40),
  email: z.string().trim().toLowerCase().max(200).pipe(z.union([z.literal(''), z.email()])).nullish().transform((value) => value || null),
  address: optionalText(300),
  birthDate: calendarDaySchema.nullish().transform((value) => value ?? null),
  place: z.enum(['shop', 'carwash']).default('shop'),
  leaveDays: z.number().min(0).max(60).multipleOf(0.5).default(20),
  note: optionalText(500),
});

export const leaveSchema = z.object({
  kind: z.enum(['taken', 'adjust']),
  from: calendarDaySchema,
  to: calendarDaySchema,
  days: z.number().min(-365).max(365).multipleOf(0.5).nullish().transform((value) => value ?? null),
  note: optionalText(300),
});

export const monthParams = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be a month like 2026-09') });

export const changesSchema = z.object({
  changes: z
    .array(z.object({ employeeId: idSchema, gross: money, reason: trimmedString(300) }))
    .max(500)
    .default([]),
});

export const payWagesSchema = z.object({
  placeId: idSchema,
  paidOn: calendarDaySchema,
  employeeIds: z.array(idSchema).max(500).nullish().transform((value) => value ?? null),
  note: optionalText(300),
});

export const payAtkSchema = z.object({ placeId: idSchema, paidOn: calendarDaySchema, note: optionalText(300) });

export const payslipParams = z.object({ id: idSchema, employeeId: idSchema });
export const langQuery = z.object({ lang: z.enum(['sq', 'en']).default('sq') });
export const declarationQuery = langQuery.extend({ format: z.enum(['xlsx', 'csv']).default('xlsx') });
