import { type Kysely, sql } from 'kysely';

/**
 * Optional two-step sign-in (a six-digit code from an authenticator app).
 *
 * - `totp_secret`: the app's secret, encrypted (AES-256-GCM, see utils/totp.ts);
 *   null while two-step sign-in is off.
 * - `totp_pending`: a secret being set up, kept until the first code proves the app has it.
 * - `totp_last_step`: the 30-second step of the last code used, so a code can't be used twice.
 * - `totp_recovery`: SHA-256 hashes of the unused backup codes.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users
      ADD COLUMN totp_secret TEXT,
      ADD COLUMN totp_pending TEXT,
      ADD COLUMN totp_enabled_at TIMESTAMPTZ,
      ADD COLUMN totp_last_step BIGINT,
      ADD COLUMN totp_recovery TEXT[] NOT NULL DEFAULT '{}'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users
      DROP COLUMN totp_secret,
      DROP COLUMN totp_pending,
      DROP COLUMN totp_enabled_at,
      DROP COLUMN totp_last_step,
      DROP COLUMN totp_recovery
  `.execute(db);
}
