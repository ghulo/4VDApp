import { rateLimit } from 'express-rate-limit';
import { RATE_LIMITS } from '../constants/rateLimits.js';

export const publicRateLimiter = rateLimit({
  windowMs: RATE_LIMITS.PUBLIC.windowMs,
  limit: RATE_LIMITS.PUBLIC.limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    data: null,
    message: 'Too many requests, please try again later',
    error: 'RATE_LIMITED',
  },
});
