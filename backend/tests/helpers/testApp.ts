import 'dotenv/config';
import type { Express } from 'express';
import { sql } from 'kysely';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { type AppConfig, loadConfig } from '../../src/config/env.js';
import { type Container, type ContainerOptions, createContainer } from '../../src/container.js';
import { createDatabase, type DatabaseClient } from '../../src/database/connection.js';
import { defaultBusinessId } from '../../src/database/business.js';
import { runAsBusiness } from '../../src/database/businessContext.js';
import type { UserRole } from '../../src/database/types.js';
import { hashPassword } from '../../src/utils/password.js';
import { freshWorkerDatabase, TEST_ROLE, workerUrl } from './testDatabases.js';

export const TEST_PASSWORD = 'correct-horse-battery';

export interface TestContext {
  app: Express;
  db: DatabaseClient;
  config: AppConfig;
  container: Container;
}

const NO_PUSH = { send: async () => ({ deadTokens: [] }) };
const NO_EMAIL = { send: async () => undefined };

/** Push senders default to ones that send nothing. */
/** `env` overrides settings, e.g. { ALLOW_SIGNUP: 'true' }. */
export async function setupTestApp(options: ContainerOptions = {}, env: Record<string, string> = {}): Promise<TestContext> {
  // Each call starts from an empty, migrated database: a fresh copy of the template (testDatabases.ts).
  const databaseUrl = await freshWorkerDatabase();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    JWT_SECRET: 'integration-test-secret-long-enough',
    ...env,
  });
  // Test setup writes outside any request: it works in the test shop (business 1).
  const db = createDatabase(databaseUrl, { role: TEST_ROLE, outsideContextBusiness: 1, poolSize: TEST_POOL });
  // The app's handle: a request that loses its business fails here as it would live. Services a test calls
  // directly, outside any request or timer, work in the test shop.
  const appDb = createDatabase(databaseUrl, { role: TEST_ROLE, outsideContextBusiness: 1, poolSize: TEST_POOL });
  const destroySetup = db.destroy.bind(db);
  db.destroy = async () => {
    await appDb.destroy();
    await destroySetup();
  };

  const container = createContainer(config, appDb, { pushSenders: { expo: NO_PUSH, web: NO_PUSH }, aiProvider: null, emailSender: NO_EMAIL, ...options });
  return { app: createApp(config, appDb, { container }), db, config, container };
}

/** Connections per handle: four workers with a few handles each must stay well under Postgres's 100. */
const TEST_POOL = 6;

/** Run work as the test shop, the way a timer runs it for each business. */
export function asShop<T>(work: () => Promise<T>): Promise<T> {
  return runAsBusiness(1, work);
}

/** The tables resetData empties (and, as TRUNCATE … CASCADE did, every table that points at them). */
const RESET_TABLES = [
  'users', 'refresh_tokens', 'categories', 'products', 'inventory', 'bulk_pricing_tiers', 'sales',
  'stock_adjustments', 'product_images', 'notifications', 'favorites', 'activity_log', 'settings', 'returns',
  'write_offs', 'stock_counts', 'stock_count_lines', 'promotions', 'carwash_days', 'carwashes', 'cash_counts',
  'cash_openings', 'pin_attempts', 'offline_shortfalls', 'rabat_approvals', 'bill_lines', 'bill_repeats',
  'no_expense_days', 'tab_entries', 'customers', 'expiry_dates', 'supplier_payments', 'supplier_bills',
  'report_subscriptions', 'purchase_order_lines', 'purchase_orders', 'suppliers', 'push_subscriptions',
  'businesses', 'media', 'invites', 'account_tokens', 'user_identities', 'email_outbox', 'document_lines',
  'documents', 'document_numbers', 'day_closings', 'ledger_queue', 'ledger_lines', 'ledger_entries',
  'vat_months', 'document_notes', 'document_threads', 'counter_events', 'book_years', 'tax_instalments',
  'tax_declarations', 'offer_lines', 'offers', 'customer_deliveries', 'partner_addresses', 'partner_offsets',
  'bonus_payouts', 'attachments', 'depreciation_lines', 'depreciation_months', 'fixed_assets', 'bill_emails',
  'bill_scans', 'stock_locations',
];

/**
 * Empty every table between tests but keep the schema.
 *
 * Same end state as `TRUNCATE <all of them> RESTART IDENTITY CASCADE`, about ten times faster: TRUNCATE
 * rebuilds each table's files even when it is empty (about 500ms for all of them, before nearly every test),
 * so only the tables that hold rows are truncated, and every sequence still goes back to its start.
 * Maintenance mode lets the check see every business's rows, not only the test shop's.
 */
export async function resetData(db: DatabaseClient): Promise<void> {
  await sql`
    DO $$
    DECLARE
      every regclass[];
      busy text[];
      seq record;
      found boolean;
      rel regclass;
    BEGIN
      PERFORM set_config('app.maintenance', 'on', true);
      WITH RECURSIVE closure(rel) AS (
        SELECT unnest(${sql.lit(`{${RESET_TABLES.join(',')}}`)}::regclass[])
        UNION
        SELECT con.conrelid::regclass FROM pg_constraint con JOIN closure ON con.confrelid = closure.rel WHERE con.contype = 'f'
      )
      SELECT array_agg(closure.rel) INTO every FROM closure;
      busy := '{}';
      FOREACH rel IN ARRAY every LOOP
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s)', rel) INTO found;
        IF found THEN busy := busy || rel::text; END IF;
      END LOOP;
      IF cardinality(busy) > 0 THEN
        EXECUTE 'TRUNCATE ' || array_to_string(busy, ', ') || ' RESTART IDENTITY CASCADE';
      END IF;
      -- An empty table's sequence may still have moved (rows added, then deleted): back to the start, like RESTART IDENTITY.
      FOR seq IN
        SELECT s.seqrelid::regclass AS name, s.seqstart AS start
        FROM pg_depend d JOIN pg_sequence s ON s.seqrelid = d.objid
        WHERE d.classid = 'pg_class'::regclass AND d.refobjid = ANY (every) AND d.deptype IN ('a', 'i')
      LOOP
        PERFORM setval(seq.name, seq.start, false);
      END LOOP;
    END $$
  `.execute(db);
  // The books and money places stay (the migrations made them), but only the test shop's: a business a test
  // created (sign-up) would otherwise leave its chart behind for the next business that gets the same id.
  await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.maintenance', 'on', true)`.execute(trx);
    for (const table of ['ledger_links', 'money_places', 'ledger_accounts']) {
      await sql`DELETE FROM ${sql.table(table)} WHERE business_id <> 1`.execute(trx);
    }
  });
  // The business first: every other row takes its business_id from it.
  await sql`INSERT INTO businesses (name) VALUES ('Test shop')`.execute(db);
  // Back to the one location every shop starts with.
  await sql`INSERT INTO stock_locations (name, sells_here, receives_here) VALUES ('Shop floor', true, true)`.execute(db);
  await sql`INSERT INTO settings (key, value) VALUES ('refund_approval_limit', '50'), ('return_window_days', '14')`.execute(db);
  await sql`INSERT INTO carwashes (name) VALUES ('Carwash')`.execute(db);
}

// Hashing is slow on purpose; hash the shared test password once.
let cachedPasswordHash: Promise<string> | undefined;

export async function createTestUser(
  db: DatabaseClient,
  role: UserRole,
  overrides: { email?: string; isActive?: boolean } = {},
) {
  cachedPasswordHash ??= hashPassword(TEST_PASSWORD);
  // 'developer' is 4VD's own staff: a flag on a main admin (tests run as the schema owner, which may set it).
  return db
    .insertInto('users')
    .values({
      email: overrides.email ?? `${role}@test.local`,
      name: `Test ${role}`,
      role: role === 'developer' ? 'main_admin' : role,
      is_platform_developer: role === 'developer',
      is_active: overrides.isActive ?? true,
      password_hash: await cachedPasswordHash,
      business_id: await defaultBusinessId(db),
      email_verified_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Create a user with the given role and return a valid access token for them. */
export async function loginAs(
  context: TestContext,
  role: UserRole,
  overrides: { email?: string } = {},
): Promise<string> {
  const user = await createTestUser(context.db, role, overrides);
  const response = await request(context.app)
    .post('/api/auth/login')
    .send({ email: user.email, password: TEST_PASSWORD });
  if (response.status !== 200) {
    throw new Error(`Test login failed: ${JSON.stringify(response.body)}`);
  }
  return response.body.data.token as string;
}

export async function createTestCategory(db: DatabaseClient, name = 'Furniture') {
  return db.insertInto('categories').values({ name }).returningAll().executeTakeFirstOrThrow();
}

/** Create a product through the API (so stock and the audit trail are set up) and return its id. */
export async function createTestProduct(
  context: TestContext,
  adminToken: string,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  let categoryId = overrides.categoryId as number | undefined;
  if (categoryId === undefined) {
    const existing = await context.db.selectFrom('categories').select('id').orderBy('id').executeTakeFirst();
    categoryId = existing?.id ?? (await createTestCategory(context.db)).id;
  }
  const response = await request(context.app)
    .post('/api/products')
    .set({ Authorization: `Bearer ${adminToken}` })
    .send({ name: 'Oak Chair', price: 100, costPrice: 60, stock: 10, reorderLevel: 2, ...overrides, categoryId });
  if (response.status !== 201) throw new Error(`Test product failed: ${JSON.stringify(response.body)}`);
  return response.body.data.id as number;
}

export async function stockOf(context: TestContext, productId: number): Promise<number> {
  const row = await context.db
    .selectFrom('inventory')
    .select('quantity_on_hand')
    .where('product_id', '=', productId)
    .executeTakeFirstOrThrow();
  return row.quantity_on_hand;
}

/**
 * A database handle with no default business, as the live server has: work
 * outside a request, timer business or script sees no business rows. For
 * testing code that runs outside requests (the server's timers).
 */
export function createLiveLikeDatabase(): DatabaseClient {
  return createDatabase(workerUrl(), { role: TEST_ROLE, poolSize: TEST_POOL });
}
