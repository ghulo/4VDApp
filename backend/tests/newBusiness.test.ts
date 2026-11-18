import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNT_LINKS, TREFIN_ACCOUNTS } from '../src/constants/chartOfAccounts.js';
import { runAsBusiness } from '../src/database/businessContext.js';
import type { DatabaseClient } from '../src/database/connection.js';
import { createBusiness } from '../src/database/newBusiness.js';
import { createDatabase } from '../src/database/connection.js';
import { createLiveLikeDatabase, setupTestApp, type TestContext } from './helpers/testApp.js';
import { workerUrl } from './helpers/testDatabases.js';

/** Tables the first business has rows in on purpose, which a new one starts without. */
const NOT_FOR_NEW_BUSINESSES: Record<string, string> = {
  carwashes: 'a new business has no carwash until one is switched on (user, 2026-11-17)',
};

/** Business tables holding rows for the business the handle is working in (row security hides the rest). */
async function filledTables(db: DatabaseClient): Promise<Map<string, number>> {
  const { rows } = await sql<{ table_name: string; n: number }>`
    select table_name, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I', table_name), false, true, '')))[1]::text::int as n
    from information_schema.columns
    where column_name = 'business_id' and table_schema = 'public'
  `.execute(db);
  return new Map(rows.filter((row) => row.n > 0).map((row) => [row.table_name, row.n]));
}

let context: TestContext;
let live: DatabaseClient;
let firstBusiness: Map<string, number>;
let newId: number;

beforeAll(async () => {
  context = await setupTestApp();
  // Straight after the migrations, before any test data: what the migrations gave the first business.
  firstBusiness = await filledTables(context.db);
  live = createLiveLikeDatabase();
  newId = await createBusiness(live, 'Dacaj Furniture', async (_trx, businessId) => businessId);
});
afterAll(async () => {
  await live.destroy();
  await context.db.destroy();
});

describe('a new business', () => {
  it('starts with everything the migrations gave the first business', async () => {
    const mine = await runAsBusiness(newId, () => filledTables(live));
    const missing = [...firstBusiness.keys()].filter((table) => !mine.has(table) && !(table in NOT_FOR_NEW_BUSINESSES));
    // A migration that seeds rows for the first business must teach seedBusiness (database/newBusiness.ts) the same.
    expect(missing).toEqual([]);
    expect(firstBusiness.size).toBeGreaterThan(3);
  });

  it('has the chart of accounts, the shop settings, Shop floor and a till, safe and bank with accounts', async () => {
    const seen = await runAsBusiness(newId, async () => ({
      accounts: await live.selectFrom('ledger_accounts').select('number').execute(),
      links: await live.selectFrom('ledger_links').select('key').execute(),
      settings: await live.selectFrom('settings').select('key').execute(),
      locations: await live.selectFrom('stock_locations').select(['name', 'sells_here', 'receives_here']).execute(),
      places: await live.selectFrom('money_places').select(['kind', 'account_id', 'carwash_id']).execute(),
      carwashes: await live.selectFrom('carwashes').select('id').execute(),
    }));
    const first = await context.db.selectFrom('settings').select('key').execute();

    const numbers = new Set(seen.accounts.map((row) => row.number));
    expect(TREFIN_ACCOUNTS.every((account) => numbers.has(account.number))).toBe(true);
    expect(seen.links.map((row) => row.key).sort()).toEqual(Object.keys(DEFAULT_ACCOUNT_LINKS).sort());
    expect(seen.settings.map((row) => row.key).sort()).toEqual(first.map((row) => row.key).sort());
    expect(seen.locations).toEqual([{ name: 'Shop floor', sells_here: true, receives_here: true }]);
    expect(seen.places.map((place) => place.kind).sort()).toEqual(['bank', 'safe', 'till']);
    expect(seen.places.every((place) => place.account_id !== null && place.carwash_id === null)).toBe(true);
    expect(seen.carwashes).toEqual([]);
  });

  it('belongs to its own tenant and leaves the first business as it was', async () => {
    const business = await context.db.selectFrom('businesses').select(['tenant_id']).where('id', '=', newId).executeTakeFirstOrThrow();
    const tenants = await context.db.selectFrom('tenants').select('id').execute();

    expect(business.tenant_id).not.toBeNull();
    expect(tenants.length).toBe(2);
    expect(await filledTables(context.db)).toEqual(firstBusiness);
  });

  it('names its own business in every seed query, so an owner connection (no row security) copies nothing from another', async () => {
    // No role: the superuser, whom row security doesn't limit (like an owner connection in a script).
    const owner = createDatabase(workerUrl(), { poolSize: 1 });
    try {
      const firstLinks = await context.db.selectFrom('ledger_links').select('key').execute();
      const id = await createBusiness(owner, 'Owner Seeded', async (_trx, businessId) => businessId);

      const rows = (table: string) => sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)} where business_id = ${id}`.execute(owner);
      const crossed = await sql<{ n: number }>`
        select (select count(*) from ledger_links l join ledger_accounts a on a.id = l.account_id where l.business_id = ${id} and a.business_id <> ${id})
             + (select count(*) from money_places p join ledger_accounts a on a.id = p.account_id where p.business_id = ${id} and a.business_id <> ${id}) as n
      `.execute(owner);
      expect(Number(crossed.rows[0]!.n)).toBe(0);
      expect((await rows('ledger_links')).rows[0]!.n).toBe(Object.keys(DEFAULT_ACCOUNT_LINKS).length);
      // The chart plus the safe's own account, as for a business seeded under row security.
      const seededUnderRowSecurity = await runAsBusiness(newId, () => live.selectFrom('ledger_accounts').select('id').execute());
      expect((await rows('ledger_accounts')).rows[0]!.n).toBe(seededUnderRowSecurity.length);
      expect((await rows('money_places')).rows[0]!.n).toBe(3);
      expect((await rows('stock_locations')).rows[0]!.n).toBe(1);
      expect(await context.db.selectFrom('ledger_links').select('key').execute()).toEqual(firstLinks);
    } finally {
      await owner.destroy();
    }
  });

  it('leaves nothing behind when the work inside it fails', async () => {
    const before = await context.db.selectFrom('businesses').select('id').execute();
    await expect(createBusiness(live, 'Never made', async () => {
      throw new Error('stop');
    })).rejects.toThrow('stop');

    expect(await context.db.selectFrom('businesses').select('id').execute()).toEqual(before);
  });
});
