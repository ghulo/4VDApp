import { type Kysely, sql } from 'kysely';

/**
 * A return of something bought on a tab takes the refund off what the customer
 * owes instead of paying out cash. The entry points at its return, so undoing
 * the return drops it again, the same way an undone sale drops its charge.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE tab_entries DROP CONSTRAINT tab_entries_kind_check`.execute(db);
  await sql`ALTER TABLE tab_entries ADD CONSTRAINT tab_entries_kind_check CHECK (kind IN ('charge', 'payment', 'refund'))`.execute(db);
  await sql`ALTER TABLE tab_entries ADD COLUMN return_id INT REFERENCES returns(id) ON DELETE SET NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM tab_entries WHERE kind = 'refund'`.execute(db);
  await sql`ALTER TABLE tab_entries DROP COLUMN IF EXISTS return_id`.execute(db);
  await sql`ALTER TABLE tab_entries DROP CONSTRAINT tab_entries_kind_check`.execute(db);
  await sql`ALTER TABLE tab_entries ADD CONSTRAINT tab_entries_kind_check CHECK (kind IN ('charge', 'payment'))`.execute(db);
}
