import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { UserRole } from '../database/types.js';
import { ForbiddenError, UnauthorizedError } from '../errors/httpErrors.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { toPublicUser } from '../services/mappers.js';
import { extractBearerToken, verifyAccessToken } from '../utils/tokens.js';

/**
 * Read the access token if there is one, without requiring it. Public routes
 * use the result to tailor responses (admins see cost prices) and the rate
 * limiter uses it to give logged-in users a higher limit.
 */
export function identifyRequester(jwtSecret: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = extractBearerToken(req.headers.authorization);
    const identity = token ? verifyAccessToken(token, jwtSecret) : null;
    if (identity) req.identity = identity;
    next();
  };
}

/**
 * Require a valid token AND a still-active account. Checking the database on
 * every request means deactivating someone or changing their role takes
 * effect immediately instead of when their 7-day token expires.
 */
export function requireAuth(userRepository: UserRepository): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.identity) throw new UnauthorizedError();

    const user = await userRepository.findById(req.identity.userId);
    if (!user || !user.is_active) throw new UnauthorizedError('Your account is no longer active');

    req.user = toPublicUser(user);
    // Trust the database role over the token, in case it changed since login.
    req.identity = { userId: user.id, email: user.email, role: user.role, sessionId: req.identity.sessionId };
    next();
  };
}

/** Must run after requireAuth. */
export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new UnauthorizedError();
    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError(`This action requires the ${allowedRoles.join(' or ')} role`);
    }
    next();
  };
}
