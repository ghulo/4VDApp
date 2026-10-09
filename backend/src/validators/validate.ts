import { z } from 'zod';
import { ValidationError } from '../errors/httpErrors.js';

/**
 * Parse untrusted input (body, params, query) against a schema. Throws a
 * ValidationError listing every problem, so the client can fix them all at
 * once instead of one round trip per mistake.
 */
export function parseInput<TSchema extends z.ZodType>(schema: TSchema, input: unknown): z.output<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const field = issue.path.join('.');
      return field ? `${field}: ${issue.message}` : issue.message;
    });
    throw new ValidationError(problems.join('; '));
  }
  return result.data;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const idSchema = z.coerce.number().int().positive();

/** A calendar day like "2026-10-04" that really exists (no 31 February). */
export const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a day like 2026-10-04')
  .refine((value) => new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'must be a real day');

export const idParamsSchema = z.object({ id: idSchema });
export const productIdParamsSchema = z.object({ productId: idSchema });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/** Query strings only carry text, so "true"/"false" need explicit parsing. */
export const booleanQuerySchema = z.enum(['true', 'false']).transform((value) => value === 'true');

export const trimmedString = (maxLength: number) => z.string().trim().min(1).max(maxLength);

/** NUI (Numri Unik Identifikues): Kosovo's 9-digit business number. Spaces are dropped. */
export const nuiSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{9}$/, 'NUI must be 9 digits'));

/** Optional text field: empty strings and null both mean "no value". */
export const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .nullish()
    .transform((value) => (value ? value : null));
