import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';
import { loadConfig } from '../config/env.js';
import { enterBusiness, runAsScript } from '../database/businessContext.js';
import { createDatabase, type DatabaseClient } from '../database/connection.js';
import { GLOBAL_TABLES } from '../database/globalTables.js';
import { logger } from '../utils/logger.js';

/**
 * One business's data, for handing a customer what is theirs (4VD's developer
 * only; it reads the database the server uses). Writes one JSON file per table
 * into a folder: every table that belongs to a business, plus the business
 * itself, its tenant, its people (memberships and their accounts), its invites
 * and the list of its stored files.
 *
 * Left out on purpose: passwords, PINs, two-step secrets, passkeys and every
 * token or link hash (they would let someone sign in), sessions, push
 * subscriptions and the email outbox. The stored files themselves (photos,
 * PDFs) aren't copied: media.json lists them by key.
 *
 *   npm run export:business -- <business id> [--out <folder>]
 */

/** Columns never written out, in any table. */
const SECRET_COLUMNS = new Set([
  'password_hash',
  'pin_hash',
  'totp_secret',
  'totp_pending',
  'totp_recovery',
  'token_hash',
  'token',
  'keys',
  'credential_id',
  'public_key',
]);

/** Global tables copied for this business, with how its rows are picked. */
const GLOBAL_PICKS: Record<string, (id: number) => ReturnType<typeof sql>> = {
  businesses: (id) => sql`select * from businesses where id = ${id}`,
  tenants: (id) => sql`select t.* from tenants t join businesses b on b.tenant_id = t.id where b.id = ${id}`,
  memberships: (id) => sql`select * from memberships where business_id = ${id}`,
  users: (id) => sql`select u.* from users u where u.id in (select user_id from memberships where business_id = ${id})`,
  invites: (id) => sql`select * from invites where business_id = ${id}`,
  media: (id) => sql`select * from media where business_id = ${id}`,
};

const clean = (rows: Record<string, unknown>[]) =>
  rows.map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => !SECRET_COLUMNS.has(column))));

async function businessTables(db: DatabaseClient): Promise<string[]> {
  const { rows } = await sql<{ table_name: string }>`
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'business_id' and t.table_type = 'BASE TABLE'
    order by c.table_name`.execute(db);
  return rows.map((row) => row.table_name).filter((name) => !GLOBAL_TABLES.includes(name));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const id = Number(args.find((arg, i) => !arg.startsWith('--') && i !== outAt + 1));
  if (!Number.isInteger(id) || id <= 0) {
    console.log('\nUsage: npm run export:business -- <business id> [--out <folder>]\n');
    process.exit(1);
  }
  const config = loadConfig();
  const db = createDatabase(config.databaseUrl);
  try {
    const business = await db.selectFrom('businesses').select(['id', 'name']).where('id', '=', id).executeTakeFirst();
    if (!business) throw new Error(`No business ${id}`);
    enterBusiness(id);
    const day = new Date().toISOString().slice(0, 10);
    const out = path.resolve(outAt === -1 ? `export-business-${id}-${day}` : args[outAt + 1]!);
    mkdirSync(out, { recursive: true });

    const counts: string[] = [];
    const write = (table: string, rows: Record<string, unknown>[]) => {
      writeFileSync(path.join(out, `${table}.json`), JSON.stringify(clean(rows), null, 1));
      counts.push(`${table}: ${rows.length}`);
    };
    for (const [table, pick] of Object.entries(GLOBAL_PICKS)) write(table, (await pick(id).execute(db)).rows as Record<string, unknown>[]);
    for (const table of await businessTables(db)) {
      // Row security already limits the rows to this business; the filter says so again for an owner connection.
      const { rows } = await sql<Record<string, unknown>>`select * from ${sql.table(table)} where business_id = ${id}`.execute(db);
      write(table, rows);
    }
    const migration = await sql<{ name: string }>`select name from kysely_migration order by name desc limit 1`.execute(db);
    writeFileSync(
      path.join(out, 'README.txt'),
      [
        `4VD export of ${business.name} (business ${id}), ${new Date().toISOString()}.`,
        `Database version: ${migration.rows[0]?.name ?? 'unknown'}.`,
        'One JSON file per table. Passwords, PINs, two-step secrets, passkeys and sign-in tokens are left out.',
        'Photos and PDFs are not included: media.json lists them by key.',
        '',
        ...counts,
      ].join('\n'),
    );
    console.log(`\nExported ${business.name} (business ${id}) to ${out}\n${counts.length} tables.\n`);
  } finally {
    await db.destroy();
  }
}

runAsScript(main).catch((error: unknown) => {
  logger.error('Exporting the business failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
