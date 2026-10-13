import { type Kysely, sql } from 'kysely';

/**
 * What an activity entry says, as a sentence key and its values, so it can be
 * written out in the reader's language. Older entries keep only their English
 * summary and show that.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE activity_log ADD COLUMN summary_say JSONB`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE activity_log DROP COLUMN IF EXISTS summary_say`.execute(db);
}
