import { type Kysely, sql } from 'kysely';

/**
 * Counter PINs: Switch person and an owner's yes to a bigger rabat.
 *
 * - `users.pin_hash`: bcrypt of the 4-6 digit PIN, set on the Account page
 *   after typing the password. `pin_cleared_at`: a password sign-in clears
 *   the person's wrong-PIN lock.
 * - `refresh_tokens.device_id`: one PC. A password sign-in starts a new one;
 *   a session started with a PIN keeps the PC's, so the per-PC lock can't be
 *   escaped by switching.
 * - `pin_attempts`: every PIN typed, right or wrong, for the locks.
 * - `rabat_approvals`: an owner's one-time yes, for 5 minutes.
 * - counter events gain 'rabat_allowed' and 'person_switched'.
 */
const OLD_KINDS = `'line_removed', 'basket_cancelled', 'drawer_opened', 'print_failed', 'reprinted', 'x_report', 'z_report'`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users ADD COLUMN pin_hash TEXT, ADD COLUMN pin_set_at TIMESTAMPTZ, ADD COLUMN pin_cleared_at TIMESTAMPTZ`.execute(db);
  await sql`ALTER TABLE refresh_tokens ADD COLUMN device_id UUID`.execute(db);
  await sql`
    CREATE TABLE pin_attempts (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      device_id UUID NOT NULL,
      purpose VARCHAR(10) NOT NULL CHECK (purpose IN ('switch', 'rabat')),
      ok BOOLEAN NOT NULL,
      at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX pin_attempts_user ON pin_attempts (user_id, at)`.execute(db);
  await sql`CREATE INDEX pin_attempts_device ON pin_attempts (device_id, at)`.execute(db);
  await sql`
    CREATE TABLE rabat_approvals (
      id UUID PRIMARY KEY,
      approved_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asked_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      basket_id VARCHAR(64) NOT NULL,
      percent NUMERIC(5, 2) NOT NULL CHECK (percent > 0 AND percent <= 100),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`ALTER TABLE counter_events DROP CONSTRAINT counter_events_kind_check`.execute(db);
  await sql`ALTER TABLE counter_events ADD CONSTRAINT counter_events_kind_check CHECK (kind IN (${sql.raw(OLD_KINDS)}, 'rabat_allowed', 'person_switched'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM counter_events WHERE kind IN ('rabat_allowed', 'person_switched')`.execute(db);
  await sql`ALTER TABLE counter_events DROP CONSTRAINT counter_events_kind_check`.execute(db);
  await sql`ALTER TABLE counter_events ADD CONSTRAINT counter_events_kind_check CHECK (kind IN (${sql.raw(OLD_KINDS)}))`.execute(db);
  await sql`DROP TABLE IF EXISTS rabat_approvals`.execute(db);
  await sql`DROP TABLE IF EXISTS pin_attempts`.execute(db);
  await sql`ALTER TABLE refresh_tokens DROP COLUMN device_id`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN pin_hash, DROP COLUMN pin_set_at, DROP COLUMN pin_cleared_at`.execute(db);
}
