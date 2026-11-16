import type { Kysely } from 'kysely';
import pg from 'pg';
import { loadConfig } from '../config/env.js';
import { createDatabase } from '../database/connection.js';
import { runMigrations } from '../database/migrator.js';
import { defaultBusinessId } from '../database/business.js';
import { hashPassword } from '../utils/password.js';
import { logger } from '../utils/logger.js';
import { seedDemoAccounts } from './demoAccounts.js';

/**
 * Usage (only from e2e/playwright.config.ts): DATABASE_URL=…/four_vd_app_e2e tsx src/scripts/prepareE2e.ts
 *
 * Drops and recreates the browser tests' own database, applies every
 * migration and adds the demo logins. Refuses any database whose name doesn't
 * end in "_e2e", so it can never wipe the shop's data or the backend tests'.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const url = new URL(config.databaseUrl);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_e2e$/.test(name)) throw new Error(`Refusing to wipe "${name}": the browser tests' database must end in _e2e`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }

  const db = createDatabase(config.databaseUrl);
  try {
    await runMigrations(db as Kysely<unknown>);
    await seedDemoAccounts(db, config.nodeEnv);
    // Payroll needs an owner (admins can't see wages); its password is public like the demo ones.
    await db
      .insertInto('users')
      .values({
        email: 'e2e-owner@4vd.local',
        name: 'E2E Owner',
        role: 'owner',
        password_hash: await hashPassword('e2e-owner-4vd'),
        business_id: await defaultBusinessId(db),
        email_verified_at: new Date(),
      })
      .execute();
    logger.info('Browser test database ready', { database: name });
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  logger.error('Preparing the browser test database failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
