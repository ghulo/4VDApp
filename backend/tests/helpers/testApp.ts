import 'dotenv/config';
import type { Express } from 'express';
import { type Kysely, sql } from 'kysely';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { type AppConfig, loadConfig } from '../../src/config/env.js';
import { createDatabase, type DatabaseClient } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import type { UserRole } from '../../src/database/types.js';
import { hashPassword } from '../../src/utils/password.js';

export const TEST_PASSWORD = 'correct-horse-battery';

export interface TestContext {
  app: Express;
  db: DatabaseClient;
  config: AppConfig;
}

function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('Set TEST_DATABASE_URL in backend/.env to run integration tests (see .env.example)');
  }
  // Guard against wiping real data by accident.
  if (!/test/i.test(url)) {
    throw new Error('TEST_DATABASE_URL must point at a database with "test" in its name');
  }
  return url;
}

/** Fresh schema for each test file. */
export async function setupTestApp(): Promise<TestContext> {
  const databaseUrl = testDatabaseUrl();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    JWT_SECRET: 'integration-test-secret-long-enough',
  });
  const db = createDatabase(databaseUrl);

  await sql`DROP SCHEMA public CASCADE`.execute(db);
  await sql`CREATE SCHEMA public`.execute(db);
  await runMigrations(db as Kysely<unknown>);

  return { app: createApp(config, db), db, config };
}

/** Empty every table between tests but keep the schema. */
export async function resetData(db: DatabaseClient): Promise<void> {
  await sql`TRUNCATE users, refresh_tokens, categories, products, inventory, bulk_pricing_tiers,
    sales, stock_adjustments, product_images, notifications, favorites, activity_log,
    settings, returns, write_offs, stock_counts, stock_count_lines RESTART IDENTITY CASCADE`.execute(db);
  await sql`INSERT INTO settings (key, value) VALUES ('refund_approval_limit', '50'), ('return_window_days', '14')`.execute(db);
}

// Hashing is slow on purpose; hash the shared test password once.
let cachedPasswordHash: Promise<string> | undefined;

export async function createTestUser(
  db: DatabaseClient,
  role: UserRole,
  overrides: { email?: string; isActive?: boolean } = {},
) {
  cachedPasswordHash ??= hashPassword(TEST_PASSWORD);
  return db
    .insertInto('users')
    .values({
      email: overrides.email ?? `${role}@test.local`,
      name: `Test ${role}`,
      role,
      is_active: overrides.isActive ?? true,
      password_hash: await cachedPasswordHash,
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
