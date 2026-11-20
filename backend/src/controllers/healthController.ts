import type { Request, RequestHandler, Response } from 'express';
import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { sendError, sendSuccess } from '../utils/apiResponse.js';

/** How long the database check waits before calling the database down. */
const DB_CHECK_MS = 5_000;

/** Render's own check: the process answers. It never touches the database, so a database blip doesn't restart the API. */
export function getHealth(_req: Request, res: Response): void {
  sendSuccess(res, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
}

/** For the outside uptime monitor: the API answers and so does its database. Reads no shop data. */
export function getDatabaseHealth(db: DatabaseClient): RequestHandler {
  return async (_req, res) => {
    let timer: NodeJS.Timeout | undefined;
    const started = Date.now();
    try {
      await Promise.race([
        sql`select 1`.execute(db),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), DB_CHECK_MS);
        }),
      ]);
      sendSuccess(res, { status: 'ok', database: 'ok', millis: Date.now() - started });
    } catch {
      sendError(res, 503, 'DATABASE_DOWN', 'The database is not answering');
    } finally {
      clearTimeout(timer);
    }
  };
}
