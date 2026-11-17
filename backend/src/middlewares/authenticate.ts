import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { enterBusiness, enterSystem, runAsBusiness } from '../database/businessContext.js';
import type { UserRole } from '../database/types.js';
import { AppError, ForbiddenError, UnauthorizedError, ViewingAsError } from '../errors/httpErrors.js';
import type { SupportRepository } from '../repositories/SupportRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { logger } from '../utils/logger.js';
import { toPublicUser } from '../services/mappers.js';
import { hasPower, isTopRole, type Power, rolesWith } from '../utils/roles.js';
import { ACCESS_COOKIE, cookieMayAct, readCookie } from '../utils/sessionCookies.js';
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
  if (!isTopRole(realRole)) return null;
  const asked = req.headers[VIEW_AS_HEADER];
  return typeof asked === 'string' && VIEWABLE_ROLES.includes(asked as UserRole) ? (asked as UserRole) : null;
}

/**
 * Read the access token if there is one, without requiring it. Public routes
 * use the result to tailor responses (admins see cost prices) and the rate
 * limiter uses it to give logged-in users a higher limit.
 */
export function identifyRequester(jwtSecret: string, allowedOrigins: ReadonlySet<string> = new Set()): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    // A Bearer header (scripts, tests) or the dashboard's cookie, which only counts for
    // a change when the request comes from one of our own pages (see cookieMayAct).
    const cookie = readCookie(req, ACCESS_COOKIE);
    const token =
      extractBearerToken(req.headers.authorization) ?? (cookie && cookieMayAct(req, allowedOrigins) ? cookie : null);
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
export function requireAuth(userRepository: UserRepository, supportRepository?: SupportRepository): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.identity) throw new UnauthorizedError();

    // The person is read before their business is named.
    enterSystem();
    const user = await userRepository.findById(req.identity.userId);
    if (!user || !user.is_active) throw new UnauthorizedError('Your account is no longer active');
    // A manager asked them to set two-step sign-in up again: an older session (tokens last days) stops here.
    if (user.two_step_required) throw new AppError('Set up two-step sign-in again: sign in with your password', 401, 'TWO_STEP_SETUP_NEEDED');

    // The business this session works in, and the person's role there. Trust the
    // database over the token, in case the role or the membership changed since login.
    const membership = await userRepository.membership(user.id, user.business_id, req.identity.businessId);
    // 4VD's own developer (a database flag, never the token) may open any business, with every power.
    const place = user.is_platform_developer ? await platformPlace(userRepository, user.business_id, req.identity.businessId, membership) : membership;
    if (!place) throw new UnauthorizedError('Your account is no longer active');
    enterBusiness(place.businessId);
    const viewed = viewedRole(req, place.role);
    if (viewed && !READS.has(req.method)) throw new ViewingAsError(viewed);
    const role = viewed ?? place.role;
    req.user = { ...toPublicUser(user), role };
    req.identity = { userId: user.id, email: user.email, role, sessionId: req.identity.sessionId, businessId: place.businessId };
    if (user.is_platform_developer && supportRepository && membership?.businessId !== place.businessId) {
      await keepSupportVisit(supportRepository, req, res, { id: user.id, name: user.name }, place.businessId);
    }
    next();
  };
}

/**
 * Where the 4VD developer works: the business his token names (any that
 * exists), else his own. Inside it he acts as 'developer'.
 */
async function platformPlace(
  userRepository: UserRepository,
  homeBusinessId: number,
  asked: number | undefined,
  membership: { businessId: number; role: UserRole } | undefined,
): Promise<{ businessId: number; role: UserRole } | undefined> {
  const businessId = asked !== undefined && (await userRepository.businessName(asked)) !== undefined ? asked : (membership?.businessId ?? homeBusinessId);
  return { businessId, role: 'developer' };
}

/**
 * The 4VD developer is in a business he isn't a member of: note the visit for
 * that business to see, and each change he makes there once it is answered.
 */
async function keepSupportVisit(support: SupportRepository, req: Request, res: Response, developer: { id: number; name: string }, businessId: number): Promise<void> {
  const visitId = await support.visit(developer, req.identity?.sessionId ?? 'no-session');
  if (READS.has(req.method)) return;
  // Kept before the change runs, so it is there even if the change fails; the answer's status follows.
  const path = `${req.baseUrl}${req.path}`;
  const parts = path.replace(/^\/api\//, '').split('/');
  const actionId = await support.action(visitId, { method: req.method, path, entity: parts[0] || null, entityId: parts.find((part) => /^\d+$/.test(part)) ?? null });
  res.on('finish', () => {
    runAsBusiness(businessId, () => support.answered(actionId, res.statusCode)).catch((error: unknown) =>
      logger.error('Could not record a support action', { error: error instanceof Error ? error.message : String(error) }),
    );
  });
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

/**
 * Changes may only come from our own pages: a browser request from any other
 * site is refused, whatever it carries. Requests without an Origin (scripts,
 * the mail Worker) pass; they can't use the cookie anyway.
 */
export function refuseForeignOrigins(allowedOrigins: ReadonlySet<string>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (!READS.has(req.method) && typeof origin === 'string' && !allowedOrigins.has(origin)) {
      throw new ForbiddenError('This request must come from the 4VD dashboard');
    }
    next();
  };
}

/** Must run after requireAuth. Lets in whoever holds at least one of the powers. */
export function requireAnyPower(...powers: Power[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new UnauthorizedError();
    if (!powers.some((power) => hasPower(req.user!.role, power))) {
      throw new ForbiddenError('Your role cannot see this');
    }
    next();
  };
}
