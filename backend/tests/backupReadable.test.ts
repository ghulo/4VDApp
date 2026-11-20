import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestContext } from './helpers/testApp.js';

/**
 * The nightly backup (pg_dump) reads every table with an empty search_path, as the
 * app's own non-owner role does here. A row-security helper that names another
 * function without its schema breaks every read there, and with it the backup.
 */
let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
});
afterAll(() => context.db.destroy());

describe('the backup can read the database', () => {
  it('reads every table under row security with an empty search path', async () => {
    const tables = (
      await sql<{ name: string }>`
        SELECT DISTINCT tablename AS name FROM pg_policies WHERE schemaname = 'public' ORDER BY 1
      `.execute(context.db)
    ).rows.map((row) => row.name);
    expect(tables.length).toBeGreaterThan(50);

    const failed: string[] = [];
    for (const table of tables) {
      try {
        await context.db.transaction().execute(async (trx) => {
          await sql`SET LOCAL search_path = ''`.execute(trx);
          await sql`SELECT count(*) FROM ${sql.table(`public.${table}`)}`.execute(trx);
        });
      } catch (error) {
        failed.push(`${table}: ${(error as Error).message}`);
      }
    }
    expect(failed).toEqual([]);
  });
});
