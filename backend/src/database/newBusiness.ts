import { type Kysely, sql } from 'kysely';
import { insertChart } from './books.js';
import { runAsBusiness } from './businessContext.js';
import type { DatabaseClient } from './connection.js';
import { ensurePlaces } from './places.js';
import type { Database } from './types.js';

/**
 * Everything a business needs before its first screen works, put into the
 * current business: the chart of accounts and its default links, the shop's
 * usual settings, a stock location that sells and receives, and the till, safe
 * and bank with their accounts. The catalogue starts empty and there is no
 * carwash (switched on later when a business has one).
 *
 * The migrations gave the first business the same things; newBusiness.test.ts
 * fails when a migration seeds something new for it that this doesn't.
 */
export async function seedBusiness(db: Kysely<unknown>): Promise<void> {
  await insertChart(db);
  await sql`
    INSERT INTO settings (key, value) VALUES
      ('refund_approval_limit', '50'),
      ('return_window_days', '14'),
      ('minimum_margin_percent', '0'),
      ('books_start', to_jsonb(current_date::text))
  `.execute(db);
  await sql`INSERT INTO stock_locations (name, sells_here, receives_here) VALUES ('Shop floor', true, true)`.execute(db);
  await ensurePlaces(db);
}

/**
 * Make a business (with its own tenant, who pays for it) and everything it
 * needs, then run `work` inside it, all in one transaction: a failure leaves
 * nothing behind. The id is taken first so the whole transaction can run
 * inside the new business, which row security needs for every insert.
 */
export async function createBusiness<T>(db: DatabaseClient, name: string, work: (trx: Kysely<Database>, businessId: number) => Promise<T>): Promise<T> {
  const { rows } = await sql<{ id: number }>`select nextval(pg_get_serial_sequence('businesses', 'id'))::int as id`.execute(db);
  const businessId = rows[0]!.id;
  return runAsBusiness(businessId, () =>
    db.transaction().execute(async (trx) => {
      const tenant = await trx.insertInto('tenants').values({ name }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('businesses').values({ id: businessId, name, tenant_id: tenant.id }).execute();
      await seedBusiness(trx as unknown as Kysely<unknown>);
      return work(trx, businessId);
    }),
  );
}
