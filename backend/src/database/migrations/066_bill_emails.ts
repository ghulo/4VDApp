import { type Kysely, sql } from 'kysely';

/**
 * Supplier bills that arrive by email at the shop's bill address. Each file
 * (a PDF, or a photo sent from a phone) is one row: it waits to be read, is
 * read into a bill scan (which then waits in To do like any scan), or is
 * marked as a file already received in an earlier email.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE bill_emails (
      id SERIAL PRIMARY KEY,
      -- The email's Message-ID, so a mail delivered twice is taken once.
      message_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      subject TEXT,
      file_name TEXT,
      media_id TEXT,
      -- SHA-256 of the file as sent: the same bill in a later email is not read again.
      file_hash CHAR(64) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'read', 'failed', 'duplicate', 'removed')),
      error TEXT,
      scan_id INTEGER REFERENCES bill_scans(id) ON DELETE SET NULL,
      -- For a duplicate: the row that brought the same file first.
      first_id INTEGER REFERENCES bill_emails(id) ON DELETE SET NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at TIMESTAMPTZ,
      UNIQUE (message_id, file_hash)
    )
  `.execute(db);
  await sql`CREATE INDEX idx_bill_emails_hash ON bill_emails (file_hash)`.execute(db);
  await sql`CREATE INDEX idx_bill_emails_open ON bill_emails (received_at) WHERE status IN ('waiting', 'failed')`.execute(db);
  // Who emailed a scan in: shown where a photo scan shows the person who took it.
  await sql`ALTER TABLE bill_scans ADD COLUMN email_from TEXT`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE bill_scans DROP COLUMN IF EXISTS email_from`.execute(db);
  await sql`DROP TABLE IF EXISTS bill_emails`.execute(db);
}
