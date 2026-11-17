/**
 * The test databases. Test files run in parallel, one database per vitest worker,
 * because every file starts from an empty, freshly migrated database:
 *
 *   <TEST_DATABASE_URL name>        the one in backend/.env; only used to reach the server
 *   <name>_tpl                      migrated once per run (tests/helpers/globalSetup.ts)
 *   <name>_w<worker>                a fresh copy of _tpl for each test file (setupTestApp)
 *
 * Copying a database is a quick file copy. Dropping and re-migrating a schema in each
 * file took a lock per table, and four workers doing it at once ran Postgres out of locks.
 */
import 'dotenv/config';
import { type Kysely, sql } from 'kysely';
import pg from 'pg';
import { createDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';

/** The ordinary database role tests run as: superusers skip row security. */
export const TEST_ROLE = 'four_vd_app_tester';

/** The database named in TEST_DATABASE_URL, before this run pointed the variable at a worker's copy. */
function baseUrl(): URL {
  const raw = (process.env.TEST_DATABASE_BASE_URL ??= process.env.TEST_DATABASE_URL);
  if (!raw) {
    throw new Error('Set TEST_DATABASE_URL in backend/.env to run integration tests (see .env.example)');
  }
  const url = new URL(raw);
  // Guard against wiping real data by accident.
  if (!/test/i.test(databaseName(url))) {
    throw new Error('TEST_DATABASE_URL must point at a database with "test" in its name');
  }
  return url;
}

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.slice(1));
}

function urlOf(name: string): string {
  const url = baseUrl();
  url.pathname = `/${encodeURIComponent(name)}`;
  return url.toString();
}

export const templateName = (): string => `${databaseName(baseUrl())}_tpl`;
export const workerName = (): string => `${databaseName(baseUrl())}_w${process.env.VITEST_POOL_ID ?? '1'}`;
export const workerUrl = (): string => urlOf(workerName());

/** Only names this file made are ever dropped: never the one in backend/.env, never a raw setting. */
function assertDroppable(name: string): void {
  if (!/test/i.test(name) || !/_(tpl|w\d+)$/.test(name)) {
    throw new Error(`Refusing to drop database "${name}"`);
  }
}

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Drop `name` (closing anyone still connected) and create it again, empty or as a copy of `template`. */
async function recreate(name: string, template?: string): Promise<void> {
  assertDroppable(name);
  const client = new pg.Client({ connectionString: baseUrl().toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${quoted(name)} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${quoted(name)}${template ? ` TEMPLATE ${quoted(template)}` : ''}`);
  } finally {
    await client.end();
  }
}

/** Build this run's template: the schema owned by the test role and migrated as it, like the app's user on Render. */
export async function buildTemplate(): Promise<void> {
  const name = templateName();
  await recreate(name);
  const url = urlOf(name);
  const admin = createDatabase(url, { poolSize: 1 });
  try {
    await sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sql.lit(TEST_ROLE)}) THEN
          CREATE ROLE ${sql.raw(TEST_ROLE)} NOLOGIN NOSUPERUSER NOBYPASSRLS;
        END IF;
      -- Roles are shared by every database on the server: another session's run may create it at the same moment.
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$
    `.execute(admin);
    await sql`DROP SCHEMA public CASCADE`.execute(admin);
    await sql`CREATE SCHEMA public AUTHORIZATION ${sql.raw(TEST_ROLE)}`.execute(admin);
  } finally {
    await admin.destroy();
  }
  // A copy fails while anyone is connected to the template, so this handle closes before any worker starts.
  const migrator = createDatabase(url, { role: TEST_ROLE, outsideContextBusiness: 1, poolSize: 1 });
  try {
    await runMigrations(migrator as Kysely<unknown>);
  } finally {
    await migrator.destroy();
  }
}

/** A fresh, migrated database for this worker's current test file. */
export async function freshWorkerDatabase(): Promise<string> {
  await recreate(workerName(), templateName());
  return workerUrl();
}
