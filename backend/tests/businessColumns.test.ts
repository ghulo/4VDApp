import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GLOBAL_TABLES } from '../src/database/globalTables.js';
import { createTestUser, resetData, setupTestApp, type TestContext } from './helpers/testApp.js';

let context: TestContext;

beforeAll(async () => {
  context = await setupTestApp();
  await resetData(context.db);
});
afterAll(() => context.db.destroy());

describe('every row belongs to a business', () => {
  it('gives every table a business_id that fills itself in, apart from the listed global ones', async () => {
    const { rows } = await sql<{ table: string; nullable: string | null; fills: string | null }>`
      SELECT c.relname AS table, col.is_nullable AS nullable, col.column_default AS fills
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN information_schema.columns col
        ON col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'business_id'
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `.execute(context.db);
    // A new table needs a business_id (add it in its migration with
    // `business_id INT NOT NULL DEFAULT current_business_id()`), or a reason to be global here and in GLOBAL_TABLES.
    const missing = rows
      .filter((row) => !GLOBAL_TABLES.includes(row.table) && row.table !== 'memberships')
      .filter((row) => row.nullable !== 'NO' || row.fills !== 'current_business_id()')
      .map((row) => row.table);
    expect(missing).toEqual([]);
  });

  it('fills business_id with the shop until a request names its business', async () => {
    const shop = await context.db.selectFrom('businesses').select('id').executeTakeFirstOrThrow();
    const { rows } = await sql<{ business_id: number }>`INSERT INTO categories (name) VALUES ('Drinks') RETURNING business_id`.execute(context.db);
    expect(rows[0]?.business_id).toBe(shop.id);
  });

  it('keeps each person’s membership in step with their role', async () => {
    const user = await createTestUser(context.db, 'employee');
    await context.db.updateTable('users').set({ role: 'admin', is_active: false }).where('id', '=', user.id).execute();
    const { rows } = await sql<{ role: string; is_active: boolean; business_id: number }>`
      SELECT role, is_active, business_id FROM memberships WHERE user_id = ${user.id}
    `.execute(context.db);
    expect(rows).toEqual([{ role: 'admin', is_active: false, business_id: user.business_id }]);
  });
});

describe('what must be unique is unique within one business', () => {
  it('lets two businesses use the same setting, category name and VAT month', async () => {
    const other = await context.db.insertInto('businesses').values({ name: 'Other shop' }).returning('id').executeTakeFirstOrThrow();
    await sql`INSERT INTO settings (key, value) VALUES ('shared_key', '1')`.execute(context.db);
    await sql`INSERT INTO settings (business_id, key, value) VALUES (${other.id}, 'shared_key', '2')`.execute(context.db);
    await sql`INSERT INTO categories (name) VALUES ('Snacks')`.execute(context.db);
    await sql`INSERT INTO categories (business_id, name) VALUES (${other.id}, 'Snacks')`.execute(context.db);
    await sql`INSERT INTO vat_months (month) VALUES ('2026-10-01')`.execute(context.db);
    await sql`INSERT INTO vat_months (business_id, month) VALUES (${other.id}, '2026-10-01')`.execute(context.db);
    // Within one business the old rule still holds.
    await expect(sql`INSERT INTO categories (name) VALUES ('snacks')`.execute(context.db)).rejects.toThrow(/duplicate key/);
  });
});
