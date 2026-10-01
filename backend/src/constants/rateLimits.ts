// Limits come from docs/API.md. Windows are in milliseconds.
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export const RATE_LIMITS = {
  PUBLIC: { windowMs: FIFTEEN_MINUTES_MS, limit: 100 },
  AUTHENTICATED: { windowMs: FIFTEEN_MINUTES_MS, limit: 500 },
  ADMIN: { windowMs: FIFTEEN_MINUTES_MS, limit: 1000 },
} as const;
