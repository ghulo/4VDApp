import { type Kysely, sql } from 'kysely';

/**
 * A daily cap on wrong Counter PINs (per person, per business): 10 wrong in a
 * rolling 24 hours locks that person's PIN in that business until a manager
 * unlocks it on People, or the tries age out. `memberships.pin_unlocked_at` is
 * when a manager last unlocked it there: wrong PINs before it don't count.
 * IF NOT EXISTS: local databases got the column by hand while this was built.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS pin_unlocked_at TIMESTAMPTZ`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE memberships DROP COLUMN IF EXISTS pin_unlocked_at`.execute(db);
}
