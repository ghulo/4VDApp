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

/** True when the IBAN's two check digits match (ISO 13616 mod 97), which catches almost every typo. */
function hasValidIbanCheck(iban: string): boolean {
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

/** An IBAN as people type it ("XK05 1212 ..."), stored without spaces in capitals; empty means none. */
export const ibanSchema = z
  .union([z.string(), z.null()])
  .transform((value) => (value === null ? '' : value.replace(/\s+/g, '').toUpperCase()))
  .pipe(
    z.union([
      z.literal('').transform(() => null),
      z
        .string()
        .regex(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, 'IBAN must start with a country code, like XK05 1212 0123 4567 8906')
        .refine(hasValidIbanCheck, 'That IBAN has a typo: its check digits do not match'),
    ]),
  );

/** Optional text field: empty strings and null both mean "no value". */
export const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .nullish()
    .transform((value) => (value ? value : null));
