import type { Kysely } from 'kysely';
import { type MigrationResultSet, Migrator } from 'kysely/migration';
import { migrations } from './migrations/index.js';

export type MigrationDirection = 'latest' | 'down';

function createMigrator(db: Kysely<unknown>): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
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
