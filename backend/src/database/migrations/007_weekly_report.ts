import { type Kysely, sql } from 'kysely';

/** Each person can switch off the Monday report email (admins get it by default). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users ADD COLUMN email_weekly_report BOOLEAN NOT NULL DEFAULT true`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS email_weekly_report`.execute(db);
}
