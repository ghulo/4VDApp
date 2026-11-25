import type { NextFunction, Request, Response } from 'express';

/**
 * A short memory for the To do list. Every open tab, the shop PC and phones
 * ask for it each minute, and one answer runs about 25 queries on a database
 * with a tenth of a CPU. For 30 seconds the same business, role and language
 * share one answer. Any change anyone makes through the API (every request
 * that isn't a read) forgets all answers, so a To do that was just dealt with
 * doesn't come back. What changes without a request (the clock, emailed
 * bills) shows up within the 30 seconds.
 */
const TTL_MS = process.env.NODE_ENV === 'test' ? 0 : 30_000;
/** Render runs one API instance; a second one would keep its own memory. */
const answers = new Map<string, { at: number; changes: number; value: Promise<unknown> }>();
let changes = 0;

export function remembered<T>(key: string, work: () => Promise<T>, now = Date.now(), ttl = TTL_MS): { value: Promise<T>; cached: boolean } {
  const hit = answers.get(key);
  if (ttl > 0 && hit && hit.changes === changes && now - hit.at < ttl) return { value: hit.value as Promise<T>, cached: true };
  const value = work();
  const entry = { at: now, changes, value };
  answers.set(key, entry);
  // A failed answer is never shared.
  value.catch(() => {
    if (answers.get(key) === entry) answers.delete(key);
  });
  return { value, cached: false };
}

/** Forgets every remembered answer once a change has gone through. */
export function forgetOnChange(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    res.on('finish', () => {
      changes += 1;
      answers.clear();
    });
  }
  next();
}
