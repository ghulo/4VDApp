import { type Kysely, sql } from 'kysely';

/**
 * Counter events made without internet wait on the shop PC and are sent
 * later, maybe twice when an answer gets lost. Each now comes with the id the
 * PC gave it (client_id), kept once per business, so a second copy is
 * dropped. Their created_at is when it happened on the PC, not when it
 * arrived (the server checks it is not in the future and not too old).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '10s'`.execute(db);
  await sql`ALTER TABLE counter_events ADD COLUMN client_id UUID`.execute(db);
  await sql`CREATE UNIQUE INDEX counter_events_client_id ON counter_events (business_id, client_id) WHERE client_id IS NOT NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS counter_events_client_id`.execute(db);
  await sql`ALTER TABLE counter_events DROP COLUMN IF EXISTS client_id`.execute(db);
}
