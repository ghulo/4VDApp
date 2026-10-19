import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { UserRole } from '../database/types.js';
import { ForbiddenError, UnauthorizedError, ViewingAsError } from '../errors/httpErrors.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { toPublicUser } from '../services/mappers.js';
import { hasPower, type Power, rolesWith } from '../utils/roles.js';
import { extractBearerToken, verifyAccessToken } from '../utils/tokens.js';

/**
 * Settings → Roles → View as: the developer sees 4VD as another role would.
 * The dashboard names the role in this header; the server then answers as if
 * the developer had that role, and refuses every change, so looking around
 * as someone else can never ring up a sale or move stock.
 */
export const VIEW_AS_HEADER = 'x-view-as';
/** The roles that have a dashboard to look at; family has none. */
export const VIEWABLE_ROLES: UserRole[] = ['admin', 'owner', 'accountant', 'employee'];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

function viewedRole(req: Request, realRole: UserRole): UserRole | null {
  if (realRole !== 'developer') return null;
  const asked = req.headers[VIEW_AS_HEADER];
  return typeof asked === 'string' && VIEWABLE_ROLES.includes(asked as UserRole) ? (asked as UserRole) : null;
}

/**
 * Read the access token if there is one, without requiring it. Public routes
 * use the result to tailor responses (admins see cost prices) and the rate
 * limiter uses it to give logged-in users a higher limit.
 */
export function identifyRequester(jwtSecret: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = extractBearerToken(req.headers.authorization);
    const identity = token ? verifyAccessToken(token, jwtSecret) : null;
    if (identity) {
      const viewed = viewedRole(req, identity.role);
      req.identity = viewed ? { ...identity, role: viewed } : identity;
    }
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

    // Trust the database role over the token, in case it changed since login.
    const viewed = viewedRole(req, user.role);
    if (viewed && !READS.has(req.method)) throw new ViewingAsError(viewed);
    const role = viewed ?? user.role;
    req.user = { ...toPublicUser(user), role };
    req.identity = { userId: user.id, email: user.email, role, sessionId: req.identity.sessionId };
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

/** Must run after requireAuth. Reads who holds `power` at the time of the request, so changes in Settings → Roles apply at once. */
export function requirePower(power: Power): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new UnauthorizedError();
    if (!hasPower(req.user.role, power)) {
      throw new ForbiddenError(`This action requires the ${rolesWith(power).join(' or ')} role`);
    }
    next();
  };
}
