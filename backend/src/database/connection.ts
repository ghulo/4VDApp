import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './types.js';

export type DatabaseClient = Kysely<Database>;

/**
 * Create the one database client the app shares. Callers own its lifetime
 * and must call `destroy()` on shutdown so the pool closes cleanly.
 */
export function createDatabase(connectionString: string): DatabaseClient {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
