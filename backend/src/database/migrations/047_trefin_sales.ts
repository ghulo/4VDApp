import { type Kysely, sql } from 'kysely';

/**
 * TREFIN's sales history beyond its receipts.
 *
 * - `documents.trefin_ref`: "<database>/<document id>" for an invoice TREFIN
 *   issued (its sales are already here, by receipt number). Such an invoice is
 *   history only: it can't be corrected, refunded from or linked to a fiscal
 *   receipt, and counts on no tab.
 * - `trefin_deleted_receipts`: receipts someone deleted in TREFIN, who did it
 *   and when, with their lines as TREFIN had them. They never were sales here;
 *   Reports → Counter lists them next to 4VD's own counter moments.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE documents ADD COLUMN trefin_ref VARCHAR(80)`.execute(db);
  await sql`CREATE UNIQUE INDEX documents_trefin_ref_idx ON documents (trefin_ref) WHERE trefin_ref IS NOT NULL`.execute(db);

  await sql`
    CREATE TABLE trefin_deleted_receipts (
      id SERIAL PRIMARY KEY,
      trefin_ref VARCHAR(80) NOT NULL UNIQUE,
      number VARCHAR(40),
      -- 'receipt' or 'invoice'
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('receipt', 'invoice')),
      sold_on DATE NOT NULL,
      deleted_at TIMESTAMPTZ NOT NULL,
      -- TREFIN's user name; TREFIN's users are not 4VD's people.
      deleted_by VARCHAR(80),
      customer VARCHAR(200),
      total NUMERIC(12, 2) NOT NULL,
      -- [{ name, quantity, total }] as TREFIN had them
      lines JSONB NOT NULL
    )
  `.execute(db);
  await sql`CREATE INDEX trefin_deleted_receipts_deleted_idx ON trefin_deleted_receipts (deleted_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS trefin_deleted_receipts`.execute(db);
  await sql`DROP INDEX IF EXISTS documents_trefin_ref_idx`.execute(db);
  await sql`ALTER TABLE documents DROP COLUMN IF EXISTS trefin_ref`.execute(db);
}
