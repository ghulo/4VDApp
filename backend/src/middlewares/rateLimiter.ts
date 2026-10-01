import type { Request } from 'express';
import { ipKeyGenerator, rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMITS } from '../constants/rateLimits.js';

const rateLimitedBody = (message: string) => ({
  success: false,
  data: null,
  message,
  error: 'RATE_LIMITED',
});

function limitFor(req: Request): number {
  if (req.identity?.role === 'admin') return RATE_LIMITS.ADMIN;
  if (req.identity) return RATE_LIMITS.AUTHENTICATED;
  return RATE_LIMITS.PUBLIC;
}

/**
 * Logged-in users are counted per account, everyone else per IP. Must run
 * after identifyRequester. Created per app so tests get a fresh counter.
 */
export function createApiRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: limitFor,
    keyGenerator: (req) => (req.identity ? `user:${req.identity.userId}` : ipKeyGenerator(req.ip ?? '')),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: rateLimitedBody('Too many requests, please try again later'),
  });
}

export function createLoginRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: RATE_LIMITS.FAILED_LOGINS,
    // Only failed attempts count, so a family member logging in on several
    // devices never gets locked out.
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: rateLimitedBody('Too many failed login attempts, please wait 15 minutes'),
  });
}
