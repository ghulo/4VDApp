import { type Kysely, sql } from 'kysely';

/**
 * An alert can say which request it is about (a return, write-off or stock
 * count waiting for approval), so deciding that request marks the alert read
 * for everyone instead of leaving "waiting for approval" behind.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE notifications ADD COLUMN subject_type VARCHAR(32), ADD COLUMN subject_id INTEGER`.execute(db);
  await sql`CREATE INDEX notifications_unread_subject_idx ON notifications (subject_type, subject_id) WHERE is_read = false`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS notifications_unread_subject_idx`.execute(db);
  await sql`ALTER TABLE notifications DROP COLUMN IF EXISTS subject_id, DROP COLUMN IF EXISTS subject_type`.execute(db);
}
