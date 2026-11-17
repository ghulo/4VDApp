import { CompiledQuery, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { logger } from '../utils/logger.js';
import { businessGuard, businessSetter } from './businessGuard.js';
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
 * Options for a database client.
 */
export interface DatabaseOptions {
  poolSize?: number;
  /** Act as this database role on every connection (tests: a non-superuser, so row security applies). */
  role?: string;
  /** Business for work outside any context. Only test setup uses it; the app never does (it fails closed). */
  outsideContextBusiness?: number;
}

/**
 * Create the one database client the app shares. Callers own its lifetime
 * and must call `destroy()` on shutdown so the pool closes cleanly.
 * Each connection is told the current business when it is taken from the pool.
 */
export function createDatabase(connectionString: string, options: DatabaseOptions = {}): DatabaseClient {
  const { role } = options;
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: createPool(connectionString, options.poolSize),
      ...(role && {
        onCreateConnection: async (connection) => {
          await connection.executeQuery(CompiledQuery.raw(`set role ${role}`));
        },
      }),
      onReserveConnection: businessSetter(options.outsideContextBusiness),
    }),
    plugins: [businessGuard],
  });
}
