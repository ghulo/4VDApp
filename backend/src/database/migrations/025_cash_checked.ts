import { type Kysely, sql } from 'kysely';

/**
 * A cash difference stays on everyone's To do until someone who oversees the
 * money says they've looked at it. Counting the drawer again clears the mark.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE cash_counts
      ADD COLUMN checked_by INT REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN checked_at TIMESTAMPTZ
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE cash_counts DROP COLUMN IF EXISTS checked_by, DROP COLUMN IF EXISTS checked_at`.execute(db);
}
