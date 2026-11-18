import { type Kysely, sql } from 'kysely';
import { insertChart } from './books.js';
import { runAsBusiness } from './businessContext.js';
import type { DatabaseClient } from './connection.js';
import { ensurePlaces } from './places.js';
import { toShortName } from '../utils/shortName.js';
import type { Database, LegalForm } from './types.js';

/**
 * Everything a business needs before its first screen works, put into the
 * current business: the chart of accounts and its default links, the shop's
 * usual settings, a stock location that sells and receives, and the till, safe
 * and bank with their accounts. The catalogue starts empty and there is no
 * carwash (switched on later when a business has one).
 *
 * The migrations gave the first business the same things; newBusiness.test.ts
 * fails when a migration seeds something new for it that this doesn't.
 *
 * Every row names `businessId` and every read filters by it, on top of row
 * security: a script or an owner connection (which row security doesn't
 * limit) must never copy or link another business's rows.
 */
export async function seedBusiness(db: Kysely<unknown>, businessId: number): Promise<void> {
  await insertChart(db, businessId);
  await sql`
    INSERT INTO settings (business_id, key, value) VALUES
      (${businessId}, 'refund_approval_limit', '50'),
      (${businessId}, 'return_window_days', '14'),
      (${businessId}, 'minimum_margin_percent', '0'),
      (${businessId}, 'books_start', to_jsonb(current_date::text))
  `.execute(db);
  await sql`INSERT INTO stock_locations (business_id, name, sells_here, receives_here) VALUES (${businessId}, 'Shop floor', true, true)`.execute(db);
  await ensurePlaces(db, businessId);
}

/**
 * Make a business (with its own tenant, who pays for it) and everything it
 * needs, then run `work` inside it, all in one transaction: a failure leaves
 * nothing behind. The id is taken first so the whole transaction can run
 * inside the new business, which row security needs for every insert.
 */
export interface NewBusinessDetails {
  /** Taken as given (a clash fails on the unique key); made from the name, free, when left out. */
  shortName?: string;
  nui?: string | null;
  legalForm?: LegalForm;
}

/** A short name made from the business name that no business uses yet: market, market-2, … */
export async function freeShortName(db: Kysely<Database>, name: string): Promise<string> {
  const base = toShortName(name);
  const taken = new Set(
    (await db.selectFrom('businesses').select('short_name').where('short_name', 'like', `${base.slice(0, 27)}%`).execute()).map((row) => row.short_name),
  );
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base.slice(0, 27)}-${n}`;
  return candidate;
}

export async function createBusiness<T>(
  db: DatabaseClient,
  name: string,
  work: (trx: Kysely<Database>, businessId: number) => Promise<T>,
  details: NewBusinessDetails = {},
): Promise<T> {
  const { rows } = await sql<{ id: number }>`select nextval(pg_get_serial_sequence('businesses', 'id'))::int as id`.execute(db);
  const businessId = rows[0]!.id;
  return runAsBusiness(businessId, () =>
    db.transaction().execute(async (trx) => {
      const tenant = await trx.insertInto('tenants').values({ name }).returning('id').executeTakeFirstOrThrow();
      await trx
        .insertInto('businesses')
        .values({
          id: businessId,
          name,
          tenant_id: tenant.id,
          short_name: details.shortName ?? (await freeShortName(trx, name)),
          nui: details.nui ?? null,
          ...(details.legalForm && { legal_form: details.legalForm }),
        })
        .execute();
      await seedBusiness(trx as unknown as Kysely<unknown>, businessId);
      return work(trx, businessId);
    }),
  );
}
