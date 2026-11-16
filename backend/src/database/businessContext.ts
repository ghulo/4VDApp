import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Which business the current piece of work is for. Every database connection
 * is told this when it is taken from the pool (`connection.ts`), and the
 * database fills in and (from phase 4) checks `business_id` with it.
 *
 * - A request starts with no business; `requireAuth` (or the portal, or sign-in
 *   once it knows the person) names it with `enterBusiness`.
 * - Timers and scripts run their work inside `runAsBusiness`.
 * - `runAsSystem` marks work done before anyone's business is known (signing
 *   in, opening an emailed link): it may only touch global tables.
 */
interface BusinessContext {
  businessId: number | null;
  /** True inside an HTTP request: a scoped query there without a business is a bug. */
  inRequest: boolean;
  /** Work before the business is known, on purpose. */
  system: boolean;
}

const storage = new AsyncLocalStorage<BusinessContext>();

export function runAsBusiness<T>(businessId: number, work: () => T): T {
  return storage.run({ businessId, inRequest: false, system: false }, work);
}

/** A one-off tool: starts with no business; it names one with enterBusiness once the database is open. */
export function runAsScript<T>(work: () => T): T {
  return storage.run({ businessId: null, inRequest: false, system: false }, work);
}

export function runAsSystem<T>(work: () => T): T {
  return storage.run({ businessId: null, inRequest: false, system: true }, work);
}

/** The business the current work is for, or null when none is set. */
export function currentBusinessId(): number | null {
  return storage.getStore()?.businessId ?? null;
}

export function currentContext(): Readonly<BusinessContext> | undefined {
  return storage.getStore();
}

/**
 * Name the business for the rest of the current request (or script). Called
 * once the person (and so their business) is known.
 */
export function enterBusiness(businessId: number): void {
  const context = storage.getStore();
  if (!context) throw new Error('enterBusiness called outside a request or runAsBusiness');
  context.businessId = businessId;
  context.system = false;
}

/** Mark the rest of this request as work before the business is known (sign-in, emailed links). */
export function enterSystem(): void {
  const context = storage.getStore();
  if (context && context.businessId === null) context.system = true;
}

/** Express: every request starts its own context, with no business yet. Mount after the body parsers. */
export function requestContext(_req: Request, _res: Response, next: NextFunction): void {
  storage.run({ businessId: null, inRequest: true, system: false }, next);
}

/** Express: routes that run before anyone's business is known (sign-in, invites, emailed links). */
export function systemRoute(_req: Request, _res: Response, next: NextFunction): void {
  enterSystem();
  next();
}
