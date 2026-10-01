import 'dotenv/config';
import type { Kysely } from 'kysely';
import { loadConfig } from '../config/env.js';
import { createDatabase } from '../database/connection.js';
import { type MigrationDirection, runMigrations } from '../database/migrator.js';
import { logger } from '../utils/logger.js';

/**
 * Usage:
 *   npm run migrate        -> apply every pending migration
 *   npm run migrate:down   -> undo the most recent migration
 */
async function main(): Promise<void> {
  const direction: MigrationDirection = process.argv.includes('--down') ? 'down' : 'latest';
  const config = loadConfig();
  const db = createDatabase(config.databaseUrl);

  try {
    const { results } = await runMigrations(db as Kysely<unknown>, direction);
    if (!results || results.length === 0) {
      logger.info('Database is already up to date');
    }
    for (const result of results ?? []) {
      logger.info('Migration finished', {
        migration: result.migrationName,
        direction: result.direction,
        status: result.status,
      });
    }
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  logger.error('Migration failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
