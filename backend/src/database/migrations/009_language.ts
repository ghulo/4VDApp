import { type Kysely, sql } from 'kysely';

/**
 * Each person reads 4VD in English or Albanian. Invites carry the language too,
 * so the invite email and the new account start in the one the inviter chose.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users ADD COLUMN language VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'sq'))`.execute(db);
  await sql`ALTER TABLE invites ADD COLUMN language VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'sq'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE invites DROP COLUMN IF EXISTS language`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS language`.execute(db);
}
