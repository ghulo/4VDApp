import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMITS } from '../constants/rateLimits.js';
import type { Container } from '../container.js';
import { ForbiddenError, UnauthorizedError } from '../errors/httpErrors.js';
import type { PortalPrincipal } from '../services/PortalService.js';
import { PORTAL_SESSION_DAYS } from '../services/PortalService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { hasPower } from '../utils/roles.js';
import { calendarDaySchema, idParamsSchema, idSchema, parseInput, quantitySchema } from '../validators/validate.js';

/**
 * Step 15, the portal for business customers. Lives under /api/portal and
 * shares nothing with the dashboard's sign-in: a portal person has a cookie,
 * never a Bearer token, and every dashboard route asks for a Bearer token.
 */

export const PORTAL_COOKIE = 'portal_session';
const COOKIE_PATH = '/api/portal';
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

declare module 'express-serve-static-core' {
  interface Request {
    portal?: PortalPrincipal;
  }
}

const rateLimitedBody = (message: string) => ({ success: false, data: null, message, error: 'RATE_LIMITED' });

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) {
      const value = part.slice(at + 1).trim();
      return /^[A-Za-z0-9_-]{20,200}$/.test(value) ? value : null;
    }
  }
  return null;
}

/**
 * Changes must come from the dashboard's own pages. SameSite=Lax already keeps
 * the cookie off other sites' form posts; this stops the rest.
 */
export function portalOriginCheck(config: AppConfig): RequestHandler {
  const allowed = new Set([...config.corsOrigins, config.dashboardUrl]);
  return (req: Request, _res: Response, next: NextFunction) => {
    if (READS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !allowed.has(origin)) throw new ForbiddenError('This request must come from the 4VD portal');
    next();
  };
}

const textOrNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const emailSchema = z.object({ email: z.email().max(254) });
const tokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/, 'This link is not complete') });
const languageSchema = z.object({ language: z.enum(['sq', 'en']) });
const linesSchema = z.array(z.object({ productId: idSchema, quantity: quantitySchema(100_000) })).max(200);
const quoteSchema = z.object({ lines: linesSchema });
const orderSchema = z.object({ lines: linesSchema.min(1, 'add at least one product'), note: textOrNull(500) });
const productsQuerySchema = z.object({ search: z.string().trim().max(100).optional(), categoryId: idSchema.optional() });
const printQuerySchema = z.object({ language: z.enum(['sq', 'en']).optional() });
const statementQuerySchema = z.object({ from: calendarDaySchema, to: calendarDaySchema });

export function createPortalRoutes({ portalService, config }: Container): Router {
  const router = Router();

  const setCookie = (res: Response, token: string) =>
    res.cookie(PORTAL_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: COOKIE_PATH,
      maxAge: PORTAL_SESSION_DAYS * 24 * 60 * 60 * 1000,
    });
  const clearCookie = (res: Response) => res.clearCookie(PORTAL_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: COOKIE_PATH });

  // One counter for the whole portal, per signed-in session or per IP.
  router.use(
    rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: RATE_LIMITS.PORTAL,
      keyGenerator: (req) => {
        const token = readCookie(req, PORTAL_COOKIE);
        return token ? `portal:${token.slice(0, 16)}` : ipKeyGenerator(req.ip ?? '');
      },
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: rateLimitedBody('Too many requests, please try again later'),
    }),
  );
  router.use(portalOriginCheck(config));

  // Asking for a link: few per IP, and few per address, so nobody floods a firm's inbox.
  const linkByIp = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: RATE_LIMITS.PORTAL_LINKS,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: rateLimitedBody('Too many tries, please wait 15 minutes'),
  });
  // Opening a link: only failed tries count, so guessing is slow but a whole team signing in isn't.
  const linkTries = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: RATE_LIMITS.PORTAL_LINKS,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: rateLimitedBody('Too many tries, please wait 15 minutes'),
  });
  const linkByEmail = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: RATE_LIMITS.PORTAL_LINKS_PER_EMAIL,
    keyGenerator: (req) => `portal-email:${String((req.body as { email?: unknown })?.email ?? '').trim().toLowerCase()}`,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: rateLimitedBody('Too many tries, please wait 15 minutes'),
  });

  router.post('/links', linkByIp, linkByEmail, async (req: Request, res: Response) => {
    const { email } = parseInput(emailSchema, req.body);
    await portalService.requestLink(email);
    sendSuccess(res, { sent: true });
  });
  // The token travels in the body, never in a URL, so it stays out of logs.
  router.post('/links/peek', linkTries, async (req: Request, res: Response) => {
    const { token } = parseInput(tokenSchema, req.body);
    sendSuccess(res, await portalService.peek(token));
  });
  router.post('/links/use', linkTries, async (req: Request, res: Response) => {
    const { token } = parseInput(tokenSchema, req.body);
    const session = await portalService.useLink(token);
    setCookie(res, session.token);
    sendSuccess(res, { signedIn: true });
  });
  router.post('/sign-out', async (req: Request, res: Response) => {
    const token = readCookie(req, PORTAL_COOKIE);
    if (token) await portalService.signOut(token);
    clearCookie(res);
    sendSuccess(res, { signedOut: true });
  });

  // Everything below needs a signed-in portal person.
  router.use(async (req: Request, res: Response, next: NextFunction) => {
    const token = readCookie(req, PORTAL_COOKIE);
    const principal = token ? await portalService.authenticate(token) : null;
    if (!principal) {
      if (token) clearCookie(res);
      throw new UnauthorizedError('Sign in to the portal');
    }
    req.portal = principal;
    res.set('Cache-Control', 'no-store');
    next();
  });

  const me = (req: Request) => req.portal!;

  router.get('/me', async (req, res) => sendSuccess(res, await portalService.me(me(req))));
  router.put('/me/language', async (req, res) => {
    const { language } = parseInput(languageSchema, req.body);
    await portalService.setLanguage(me(req), language);
    sendSuccess(res, { language });
  });
  router.get('/products', async (req, res) => sendSuccess(res, await portalService.catalogue(me(req), parseInput(productsQuerySchema, req.query))));
  router.post('/quote', async (req, res) => sendSuccess(res, await portalService.quote(me(req), parseInput(quoteSchema, req.body).lines)));
  router.get('/orders', async (req, res) => sendSuccess(res, await portalService.orders(me(req))));
  router.post('/orders', async (req, res) => {
    const order = await portalService.placeOrder(me(req), parseInput(orderSchema, req.body));
    sendSuccess(res, order, { message: 'Order sent', statusCode: 201 });
  });
  router.get('/orders/:id', async (req, res) => sendSuccess(res, await portalService.order(me(req), parseInput(idParamsSchema, req.params).id)));
  router.get('/orders/:id/again', async (req, res) => sendSuccess(res, await portalService.reorder(me(req), parseInput(idParamsSchema, req.params).id)));
  router.post('/orders/:id/agree', async (req, res) => sendSuccess(res, await portalService.agree(me(req), parseInput(idParamsSchema, req.params).id)));
  router.post('/orders/:id/cancel', async (req, res) => sendSuccess(res, await portalService.cancel(me(req), parseInput(idParamsSchema, req.params).id)));
  router.get('/invoices', async (req, res) => sendSuccess(res, await portalService.documents(me(req))));
  router.get('/invoices/:id/print', async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    const { language } = parseInput(printQuerySchema, req.query);
    const html = await portalService.documentHtml(me(req), id, language ?? me(req).language);
    res.type('html').send(html);
  });
  router.get('/account', async (req, res) => sendSuccess(res, await portalService.account(me(req))));
  router.get('/statement', async (req, res) => {
    const { from, to } = parseInput(statementQuerySchema, req.query);
    sendSuccess(res, await portalService.statement(me(req), from, to));
  });

  return router;
}

// ——— The shop's side, in the dashboard ———

/** Owners, and whoever holds the manage power, decide who gets into the portal. */
export const ownerOrManager: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) throw new UnauthorizedError();
  if (req.user.role !== 'owner' && !hasPower(req.user.role, 'manage')) throw new ForbiddenError('Only the owner can change the portal');
  next();
};

const settingsSchema = z.object({
  enabled: z.boolean(),
  canOrder: z.boolean(),
  minOrder: z.number().positive().max(1_000_000).multipleOf(0.01).nullable(),
  categories: z.array(idSchema).max(500).nullable(),
});
const inviteSchema = z
  .object({
    name: z.string().trim().min(1, 'type their name').max(120),
    email: z.email().max(254).nullish().transform((value) => value ?? null),
    phone: textOrNull(40),
    language: z.enum(['sq', 'en']).default('sq'),
    sendEmail: z.boolean().default(false),
  })
  .refine((input) => !input.sendEmail || input.email !== null, { path: ['email'], message: 'type an email to send the link to' });
const reinviteSchema = z.object({ sendEmail: z.boolean().default(false) });
const declineSchema = z.object({ reason: textOrNull(300) });
const changeSchema = z.object({ lines: linesSchema.min(1, 'keep at least one product'), reason: z.string().trim().min(1, 'say why the order changed').max(300) });
const personParamsSchema = z.object({ id: idSchema, personId: idSchema });
const shopOrdersQuerySchema = z.object({ customerId: idSchema.optional() });

export function createShopPortalRoutes({ portalService, guards }: Container): Router {
  const router = Router();
  const owner = [guards.authenticated, ownerOrManager];

  router.get('/customers/:id', ...owner, async (req, res) => sendSuccess(res, await portalService.settings(parseInput(idParamsSchema, req.params).id)));
  router.put('/customers/:id', ...owner, async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await portalService.saveSettings(id, parseInput(settingsSchema, req.body), req.user!.id));
  });
  router.post('/customers/:id/people', ...owner, async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await portalService.invite(id, parseInput(inviteSchema, req.body), req.user!.id), { message: 'Invited', statusCode: 201 });
  });
  router.post('/customers/:id/people/:personId/link', ...owner, async (req, res) => {
    const { personId } = parseInput(personParamsSchema, req.params);
    sendSuccess(res, await portalService.reinvite(personId, parseInput(reinviteSchema, req.body ?? {}), req.user!.id));
  });
  router.delete('/customers/:id/people/:personId', ...owner, async (req, res) => {
    const { personId } = parseInput(personParamsSchema, req.params);
    await portalService.removePerson(personId, req.user!.id);
    sendSuccess(res, null);
  });
  router.post('/customers/:id/sign-out', ...owner, async (req, res) => {
    await portalService.signOutEverywhere(parseInput(idParamsSchema, req.params).id, req.user!.id);
    sendSuccess(res, null);
  });

  router.get('/orders', ...guards.oversee, async (req, res) => sendSuccess(res, await portalService.shopOrders(parseInput(shopOrdersQuerySchema, req.query))));
  router.get('/orders/:id', ...guards.oversee, async (req, res) => sendSuccess(res, await portalService.shopOrder(parseInput(idParamsSchema, req.params).id, req.user!.id)));
  router.post('/orders/:id/accept', ...guards.oversee, async (req, res) => sendSuccess(res, await portalService.accept(parseInput(idParamsSchema, req.params).id, req.user!.id)));
  router.put('/orders/:id', ...guards.oversee, async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await portalService.change(id, parseInput(changeSchema, req.body), req.user!.id));
  });
  router.post('/orders/:id/decline', ...guards.oversee, async (req, res) => {
    const { id } = parseInput(idParamsSchema, req.params);
    sendSuccess(res, await portalService.decline(id, parseInput(declineSchema, req.body ?? {}).reason, req.user!.id));
  });

  return router;
}
