import { type Kysely, sql } from 'kysely';

/**
 * Passkeys: sign-in with the device's own lock (Windows Hello, Touch ID,
 * Face ID, an Android fingerprint). One row per passkey; a passkey belongs to
 * the person, not a business, so it works in every business they belong to
 * (a global table, listed in database/globalTables.ts).
 *
 * - `credential_id` / `public_key`: what the device made; the private key never leaves it.
 * - `counter`: the device's use count, so a copied key can be told apart (0 for synced passkeys).
 * - `backed_up`: synced to the person's other devices (iCloud Keychain, Google Password Manager).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE passkeys (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key BYTEA NOT NULL,
      counter BIGINT NOT NULL DEFAULT 0,
      transports TEXT[] NOT NULL DEFAULT '{}',
      backed_up BOOLEAN NOT NULL DEFAULT false,
      aaguid TEXT,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ
    )
  `.execute(db);
  await sql`CREATE INDEX passkeys_user_id_idx ON passkeys (user_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE passkeys`.execute(db);
}
