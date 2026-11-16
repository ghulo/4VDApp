import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { logger } from '../utils/logger.js';
import { businessGuard, setConnectionBusiness } from './businessGuard.js';
import type { Database } from './types.js';

export type DatabaseClient = Kysely<Database>;

/**
 * The connection pool. When the database drops an idle connection (a restart,
 * a plan upgrade, maintenance), pg reports it on the pool; without a listener
 * Node would crash the whole server. We log it instead, and the pool opens a
 * fresh connection for the next query.
 */
export function createPool(connectionString: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString, max });
  pool.on('error', (error) => {
    logger.warn('Lost an idle database connection; a new one will be opened', { error: error.message });
  });
  return pool;
}

/**
 * Create the one database client the app shares. Callers own its lifetime
 * and must call `destroy()` on shutdown so the pool closes cleanly.
 * Each connection is told the current business when it is taken from the pool.
 */
export function createDatabase(connectionString: string, poolSize?: number): DatabaseClient {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: createPool(connectionString, poolSize), onReserveConnection: setConnectionBusiness }),
    plugins: [businessGuard],
  });
}
