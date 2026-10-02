import { type Kysely, sql } from 'kysely';

/**
 * Push alerts to phones (Expo) and browsers (Web Push), with per-person
 * settings. The notifications table doubles as the outbox: a background
 * sender pushes every row whose pushed_at is still empty.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const statements = [
    sql`CREATE TABLE push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('expo', 'web')),
      -- The Expo push token, or the Web Push endpoint URL. One device, one row.
      token TEXT NOT NULL UNIQUE,
      -- Web Push encryption keys ({ p256dh, auth }); null for Expo.
      keys JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ
    )`,
    sql`CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id)`,
    // Topic -> false for the ones the person turned off. Missing means on.
    sql`ALTER TABLE users ADD COLUMN push_preferences JSONB NOT NULL DEFAULT '{}'`,
    sql`ALTER TABLE notifications ADD COLUMN pushed_at TIMESTAMPTZ`,
    // Never push the history that existed before push did.
    sql`UPDATE notifications SET pushed_at = now()`,
    sql`CREATE INDEX idx_notifications_unpushed ON notifications(created_at) WHERE pushed_at IS NULL`,
  ];

  for (const statement of statements) {
    await statement.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_notifications_unpushed`.execute(db);
  await sql`ALTER TABLE notifications DROP COLUMN IF EXISTS pushed_at`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS push_preferences`.execute(db);
  await sql`DROP TABLE IF EXISTS push_subscriptions`.execute(db);
}
