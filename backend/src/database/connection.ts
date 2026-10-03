import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { logger } from '../utils/logger.js';
import type { Database } from './types.js';

export type DatabaseClient = Kysely<Database>;

/**
 * The connection pool. When the database drops an idle connection (a restart,
 * a plan upgrade, maintenance), pg reports it on the pool; without a listener
 * Node would crash the whole server. We log it instead, and the pool opens a
 * fresh connection for the next query.
 */
export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on('error', (error) => {
    logger.warn('Lost an idle database connection; a new one will be opened', { error: error.message });
  });
  return pool;
}

/**
 * Create the one database client the app shares. Callers own its lifetime
 * and must call `destroy()` on shutdown so the pool closes cleanly.
 */
export function createDatabase(connectionString: string): DatabaseClient {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: createPool(connectionString) }) });
}
