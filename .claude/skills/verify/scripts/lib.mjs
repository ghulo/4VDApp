// Shared helpers for the verify scripts. Plain Node, no install: pg and
// Playwright are borrowed from backend/ and e2e/ node_modules.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const API = 'http://localhost:3000';
export const WEB = 'http://localhost:5173';
export const DEMO_DB = 'four_vd_app_demo';
export const REAL_DB = 'four_vd_app';
/**
 * The role api-demo acts as: not a superuser, no BYPASSRLS, not the tables' owner,
 * so row security keeps businesses apart on demo as it does live (fourvd_app).
 */
export const DEMO_APP_ROLE = 'four_vd_app_demo_app';
/** A category that exists only in the demo database: how port 3000 proves which database it serves. */
export const MARKER = 'VERIFY demo database';

export const DEMO_USERS = {
  admin: { email: 'demo-admin@4vd.local', password: 'demo-admin-4vd' },
  employee: { email: 'demo-employee@4vd.local', password: 'demo-employee-4vd' },
  family: { email: 'demo-family@4vd.local', password: 'demo-family-4vd' },
  accountant: { email: 'demo-accountant@4vd.local', password: 'demo-accountant-4vd' },
};

export const requireBackend = createRequire(path.join(ROOT, 'backend', 'package.json'));
export const requireE2e = createRequire(path.join(ROOT, 'e2e', 'package.json'));

/** backend/.env's DATABASE_URL with its database name swapped. */
export function databaseUrl(name) {
  const env = readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
  const local = /^DATABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
  if (!local) throw new Error('No DATABASE_URL in backend/.env');
  const url = new URL(local);
  url.pathname = `/${name}`;
  return url.toString();
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Which database answers on port 3000: 'down', 'demo' (the marker category is
 * there), 'real' (signed in, list read, no marker), 'limited' (the API's rate
 * limit, 15 minutes) or 'unknown' (up, but the demo login or the list failed).
 * Only a full, successful read ever says 'real' or 'demo'.
 */
export async function probe() {
  try {
    const health = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) return 'down';
  } catch {
    return 'down';
  }
  try {
    // No Origin header: the token comes back in the body (Bearer path), no cookies.
    const login = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // demo-family: the rate limit counts per login, so probing never eats the quota of the logins the screens use.
      body: JSON.stringify(DEMO_USERS.family),
      signal: AbortSignal.timeout(10000),
    });
    if (!login.ok) return login.status === 429 ? 'limited' : 'unknown';
    const body = await login.json();
    const token = body.data?.accessToken ?? body.data?.token;
    const headers = { authorization: `Bearer ${token}` };
    const res = await fetch(`${API}/api/categories`, { headers, signal: AbortSignal.timeout(10000) });
    // Rate limited or any other refusal: we can't tell, so never guess.
    if (!res.ok) return res.status === 429 ? 'limited' : 'unknown';
    const list = (await res.json()).data;
    const names = (Array.isArray(list) ? list : (list?.categories ?? [])).map((c) => c.name);
    // Sign out so the token doesn't linger.
    await fetch(`${API}/api/auth/logout`, { method: 'POST', headers }).catch(() => {});
    return names.includes(MARKER) ? 'demo' : 'real';
  } catch {
    return 'unknown';
  }
}
