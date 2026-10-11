import { type Kysely, sql } from 'kysely';

/**
 * Which app turned alerts on for a device: the dashboard or the team app.
 * Someone with alerts on in the dashboard gets them only there, not twice.
 * Devices from before this are counted as the team app until the dashboard
 * registers its own again.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE push_subscriptions
    ADD COLUMN app VARCHAR(10) NOT NULL DEFAULT 'team' CHECK (app IN ('dashboard', 'team'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE push_subscriptions DROP COLUMN IF EXISTS app`.execute(db);
}
