import { type Kysely, sql } from 'kysely';
import { type Migration, type MigrationResultSet, Migrator } from 'kysely/migration';
import { migrations } from './migrations/index.js';

export type MigrationDirection = 'latest' | 'down';

/**
 * Migrations see and change every business's rows: row security (081) would
 * otherwise hide them all. Set for the migration's transaction only (Postgres
 * runs all pending migrations in one).
 */
function inMaintenance(all: Record<string, Migration>): Record<string, Migration> {
  const on = (db: Kysely<unknown>) => sql`select set_config('app.maintenance', 'on', true)`.execute(db);
  return Object.fromEntries(
    Object.entries(all).map(([name, migration]) => [
      name,
      {
        up: async (db) => {
          await on(db);
          await migration.up(db);
        },
        down: migration.down
          ? async (db) => {
              await on(db);
              await migration.down!(db);
            }
          : undefined,
      },
    ]),
  );
}

function createMigrator(db: Kysely<unknown>): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: async () => inMaintenance(migrations) },
    // Work is built in parallel branches, each with its next-numbered migration; one merged later may sort before one a database already ran.
    allowUnorderedMigrations: true,
  });
}

/** Run migrations and throw if any of them failed. */
export async function runMigrations(
  db: Kysely<unknown>,
  direction: MigrationDirection = 'latest',
): Promise<MigrationResultSet> {
  const migrator = createMigrator(db);
  const resultSet =
    direction === 'latest' ? await migrator.migrateToLatest() : await migrator.migrateDown();

  if (resultSet.error) {
    const failed = resultSet.results?.find((result) => result.status === 'Error');
    const reason =
      resultSet.error instanceof Error ? resultSet.error.message : String(resultSet.error);
    throw new Error(`Migration ${failed?.migrationName ?? '(unknown)'} failed: ${reason}`);
  }
  return resultSet;
}
