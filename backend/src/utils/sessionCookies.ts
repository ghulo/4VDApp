import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

/**
 * The dashboard's sign-in lives in two httpOnly cookies, so a script that got
 * into a page can't read or steal it:
 * - the access cookie goes with every /api request;
 * - the refresh cookie only to /api/auth, where it is swapped for a new pair.
 * No Domain is set, so they stay on api.4vd.app (same site as 4vd.app, which
 * is what lets SameSite=Lax send them). The portal has its own cookie
 * (portal_session) that neither side accepts from the other.
 */
export const ACCESS_COOKIE = 'vd_access';
export const REFRESH_COOKIE = 'vd_refresh';
const ACCESS_PATH = '/api';
const REFRESH_PATH = '/api/auth';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** A cookie's value, or null when missing or not shaped like one of ours. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) {
      const value = part.slice(at + 1).trim();
      return /^[A-Za-z0-9_.-]{20,2000}$/.test(value) ? value : null;
    }
  }
  return null;
}

/**
 * Cross-site request forgery: a change made with a cookie must come from one
 * of our own pages. Browsers always send Origin on such requests; with none,
 * the cookie is simply not used (scripts and the mail Worker use other keys).
 */
export function cookieMayAct(req: Request, allowedOrigins: ReadonlySet<string>): boolean {
  if (SAFE_METHODS.has(req.method)) return true;
  const origin = req.headers.origin;
  return typeof origin === 'string' && allowedOrigins.has(origin);
}

export function allowedOriginsOf(config: { corsOrigins: string[]; dashboardUrl: string }): Set<string> {
  return new Set([...config.corsOrigins, config.dashboardUrl]);
}

/** A browser asked: it gets cookies, and the tokens stay out of reach of page scripts. */
export function isBrowser(req: Request): boolean {
  return typeof req.headers.origin === 'string';
}

function msUntilExpiry(accessToken: string): number | undefined {
  const decoded = jwt.decode(accessToken);
  if (decoded && typeof decoded === 'object' && typeof decoded.exp === 'number') {
    return Math.max(0, decoded.exp * 1000 - Date.now());
  }
  return undefined;
}

const base = { httpOnly: true, secure: true, sameSite: 'lax' as const };

export function setSessionCookies(res: Response, tokens: { token: string; refreshToken: string }, refreshTtlDays: number): void {
  res.cookie(ACCESS_COOKIE, tokens.token, { ...base, path: ACCESS_PATH, maxAge: msUntilExpiry(tokens.token) });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...base, path: REFRESH_PATH, maxAge: refreshTtlDays * 24 * 60 * 60 * 1000 });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base, path: ACCESS_PATH });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_PATH });
}

/**
 * Hand a new session over: cookies always; the tokens themselves only to
 * callers that are not browsers (scripts, tests), never to a page.
 */
export function deliverSession<T extends { token: string; refreshToken: string }>(
  req: Request,
  res: Response,
  result: T,
  refreshTtlDays: number,
): Omit<T, 'token' | 'refreshToken'> | T {
  setSessionCookies(res, result, refreshTtlDays);
  if (!isBrowser(req)) return result;
  const { token: _token, refreshToken: _refresh, ...rest } = result;
  return rest;
}
