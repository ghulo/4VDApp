import { type Kysely, sql } from 'kysely';

/**
 * Real accounts (see docs/superpowers/specs/2026-10-02-rebrand-accounts-design.md):
 *
 * - businesses: the SaaS foundation. One row today; every user belongs to it.
 * - media: small images (photos, the shop logo) kept in the database.
 * - invites / account_tokens: one-use links sent by email, stored only as hashes.
 * - user_identities: sign-in with Google (and later Apple).
 * - email_outbox: emails waiting to be sent by the background loop.
 * - refresh_tokens gains a session id that survives each refresh, so people
 *   can see their devices and log one out.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const statements = [
    sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`,
    sql`CREATE TABLE businesses (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      address TEXT,
      phone VARCHAR(50),
      currency CHAR(3) NOT NULL DEFAULT 'EUR',
      time_zone VARCHAR(64),
      logo_media_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    sql`CREATE TABLE media (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
      mime VARCHAR(50) NOT NULL,
      bytes BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    sql`ALTER TABLE businesses ADD CONSTRAINT businesses_logo_fk FOREIGN KEY (logo_media_id) REFERENCES media(id) ON DELETE SET NULL`,

    sql`INSERT INTO businesses (name) VALUES ('4VD')`,
    sql`ALTER TABLE users ADD COLUMN business_id INT REFERENCES businesses(id)`,
    sql`UPDATE users SET business_id = (SELECT min(id) FROM businesses)`,
    sql`ALTER TABLE users ALTER COLUMN business_id SET NOT NULL`,
    sql`ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ`,
    // Everyone who already has an account was set up by the owner by hand.
    sql`UPDATE users SET email_verified_at = now()`,
    sql`ALTER TABLE users ADD COLUMN phone VARCHAR(50)`,
    sql`ALTER TABLE users ADD COLUMN avatar_media_id UUID REFERENCES media(id) ON DELETE SET NULL`,
    sql`ALTER TABLE users ADD COLUMN theme VARCHAR(10) NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system'))`,
    sql`ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ`,
    // Accounts made only through Google have no password.
    sql`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`,

    sql`CREATE TABLE invites (
      id SERIAL PRIMARY KEY,
      business_id INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'employee', 'family')),
      token_hash CHAR(64) NOT NULL UNIQUE,
      invited_by INT REFERENCES users(id),
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    sql`CREATE INDEX idx_invites_business ON invites(business_id)`,

    sql`CREATE TABLE account_tokens (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'change_email')),
      token_hash CHAR(64) NOT NULL UNIQUE,
      new_email VARCHAR(255),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    sql`CREATE INDEX idx_account_tokens_user ON account_tokens(user_id, purpose)`,

    sql`CREATE TABLE user_identities (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(20) NOT NULL CHECK (provider IN ('google', 'apple')),
      subject VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (provider, subject)
    )`,

    sql`CREATE TABLE email_outbox (
      id SERIAL PRIMARY KEY,
      to_address VARCHAR(255) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      html TEXT NOT NULL,
      text TEXT NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      last_error TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    sql`CREATE INDEX idx_email_outbox_unsent ON email_outbox(created_at) WHERE sent_at IS NULL`,

    sql`ALTER TABLE refresh_tokens ADD COLUMN session_id UUID NOT NULL DEFAULT gen_random_uuid()`,
    sql`ALTER TABLE refresh_tokens ADD COLUMN user_agent VARCHAR(500)`,
    sql`ALTER TABLE refresh_tokens ADD COLUMN ip VARCHAR(64)`,
    sql`ALTER TABLE refresh_tokens ADD COLUMN last_used_at TIMESTAMPTZ`,
    sql`CREATE INDEX idx_refresh_tokens_session ON refresh_tokens(session_id)`,
  ];

  for (const statement of statements) {
    await statement.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const statements = [
    sql`DROP INDEX IF EXISTS idx_refresh_tokens_session`,
    sql`ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS last_used_at`,
    sql`ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS ip`,
    sql`ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS user_agent`,
    sql`ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS session_id`,
    sql`DROP TABLE IF EXISTS email_outbox`,
    sql`DROP TABLE IF EXISTS user_identities`,
    sql`DROP TABLE IF EXISTS account_tokens`,
    sql`DROP TABLE IF EXISTS invites`,
    sql`ALTER TABLE users DROP COLUMN IF EXISTS last_login_at`,
    sql`ALTER TABLE users DROP COLUMN IF EXISTS theme`,
    sql`ALTER TABLE users DROP COLUMN IF EXISTS avatar_media_id`,
    sql`ALTER TABLE users DROP COLUMN IF EXISTS phone`,
    sql`ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at`,
    sql`ALTER TABLE users DROP COLUMN IF EXISTS business_id`,
    sql`ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_logo_fk`,
    sql`DROP TABLE IF EXISTS media`,
    sql`DROP TABLE IF EXISTS businesses`,
  ];
  for (const statement of statements) {
    await statement.execute(db);
  }
}
