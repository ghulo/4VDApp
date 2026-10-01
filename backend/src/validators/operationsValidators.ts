import { z } from 'zod';
import { USER_ROLES } from '../database/types.js';
import { MIN_PASSWORD_LENGTH } from '../utils/password.js';
import { booleanQuerySchema, idSchema, optionalText, paginationSchema, trimmedString } from './validate.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'must be a date like 2026-10-01');

/** "2026-10-01" as a start means the very beginning of that day (UTC). */
export const startDateQuery = isoDate.transform((value) => new Date(value));

/**
 * "2026-10-31" as an end date means "up to and including the 31st", so a
 * date without a time is pushed to the start of the next day (ranges are
 * end-exclusive internally).
 */
export const endDateQuery = isoDate.transform((value) =>
  DATE_ONLY.test(value) ? new Date(new Date(value).getTime() + MS_PER_DAY) : new Date(value),
);

// ---------- Sales ----------

export const recordSaleSchema = z.object({
  productId: idSchema,
  quantity: z.number().int().min(1).max(1_000_000),
  notes: optionalText(1000),
  saleDate: isoDate.transform((value) => new Date(value)).optional(),
});

export const saleQuerySchema = paginationSchema.extend({
  startDate: startDateQuery.optional(),
  endDate: endDateQuery.optional(),
  productId: idSchema.optional(),
});

// ---------- Analytics ----------

export const dashboardQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
});

export const revenueQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
  startDate: startDateQuery.optional(),
  endDate: endDateQuery.optional(),
  productId: idSchema.optional(),
});

// ---------- Users ----------

const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200);

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: trimmedString(255),
  role: z.enum(USER_ROLES),
  password,
});

export const updateUserSchema = z
  .object({
    name: trimmedString(255).optional(),
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
    password: password.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'send at least one of: name, role, isActive, password',
  });

export const userQuerySchema = paginationSchema.extend({
  role: z.enum(USER_ROLES).optional(),
});

// ---------- Notifications ----------

export const notificationQuerySchema = paginationSchema.extend({
  unreadOnly: booleanQuerySchema.default(false),
});
