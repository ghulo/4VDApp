// PostgreSQL error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

/** True when an insert/update hit a unique index (optionally a specific one). */
export function isUniqueViolation(error: unknown, constraintName?: string): boolean {
  if (!hasCode(error, UNIQUE_VIOLATION)) return false;
  return !constraintName || (error as { constraint?: string }).constraint === constraintName;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return hasCode(error, FOREIGN_KEY_VIOLATION);
}

/** Escape LIKE wildcards so a search for "50%" matches the text "50%". */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
