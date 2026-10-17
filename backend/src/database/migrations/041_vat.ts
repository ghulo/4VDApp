import { type Kysely, sql } from 'kysely';

const ROLES_BEFORE = sql.raw(`('developer', 'admin', 'owner', 'employee', 'family')`);
const ROLES_AFTER = sql.raw(`('developer', 'admin', 'owner', 'employee', 'family', 'accountant')`);
/** Tables whose rate is chosen by someone: a product, a product someone asked for, and a bill's line. */
const RATED_TABLES = ['products', 'product_requests', 'bill_lines'] as const;

/**
 * The VAT month, as the accountant files it.
 *
 * - The accountant: a role that reads the books, VAT, bills, invoices, expenses,
 *   reports and the customer and supplier lists, files and reopens a month, and
 *   asks questions on documents.
 * - VAT rates: 16% and "exempt" next to 18, 8 and 0. Exempt is a 0% rate with
 *   `vat_exempt` set, so every sum stays a plain rate sum; it only decides which
 *   box of the VAT return a figure goes in (exempt sales are box 9, 0% box 10).
 * - `vat_months`: one row per month someone has touched (filed, refund asked
 *   for, or the credit carried in typed by hand). A filed month keeps the
 *   return as it was filed, and nothing dated in it can change until it is
 *   reopened.
 * - `supplier_bills.vat_month`: a bill dated in a month that was already filed
 *   is counted in the next open month instead (null: its own month).
 * - Questions on documents: a thread per document, open until someone who runs
 *   the shop answers.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of ['users', 'invites']) {
    await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT IF EXISTS ${sql.raw(`${table}_role_check`)}`.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} ADD CONSTRAINT ${sql.raw(`${table}_role_check`)} CHECK (role IN ${ROLES_AFTER})`.execute(db);
  }

  for (const table of RATED_TABLES) {
    await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT IF EXISTS ${sql.raw(`${table}_vat_rate_check`)}`.execute(db);
    await sql`
      ALTER TABLE ${sql.table(table)}
        ADD CONSTRAINT ${sql.raw(`${table}_vat_rate_check`)} CHECK (vat_rate IN (0, 8, 16, 18)),
        ADD COLUMN vat_exempt BOOLEAN NOT NULL DEFAULT false,
        ADD CONSTRAINT ${sql.raw(`${table}_vat_exempt_check`)} CHECK (NOT vat_exempt OR vat_rate = 0)
    `.execute(db);
  }
  await sql`ALTER TABLE document_lines ADD COLUMN vat_exempt BOOLEAN NOT NULL DEFAULT false`.execute(db);
  await sql`ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_usual_vat_rate_check`.execute(db);
  await sql`
    ALTER TABLE suppliers
      ADD CONSTRAINT suppliers_usual_vat_rate_check CHECK (usual_vat_rate IN (0, 8, 16, 18)),
      ADD COLUMN usual_vat_exempt BOOLEAN NOT NULL DEFAULT false
  `.execute(db);

  await sql`
    CREATE TABLE vat_months (
      month DATE PRIMARY KEY CHECK (extract(day FROM month) = 1),
      filed_at TIMESTAMPTZ,
      filed_by INT REFERENCES users(id) ON DELETE SET NULL,
      -- The return as it was when filed, so the next month's carried credit never moves.
      figures JSONB,
      -- Box 70: the part of the credit the shop asks ATK to pay back.
      refund NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (refund >= 0),
      -- Box 68 typed by hand, for the first month 4VD files (TREFIN's last credit).
      carried_in NUMERIC(12, 2) CHECK (carried_in >= 0),
      updated_by INT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK ((filed_at IS NULL) = (figures IS NULL))
    )
  `.execute(db);

  await sql`ALTER TABLE supplier_bills ADD COLUMN vat_month DATE CHECK (vat_month IS NULL OR extract(day FROM vat_month) = 1)`.execute(db);

  await sql`
    CREATE TABLE document_threads (
      id SERIAL PRIMARY KEY,
      -- What the question is about, e.g. 'bill:12', 'document:5', 'entry:40'.
      subject VARCHAR(40) NOT NULL UNIQUE,
      status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered')),
      opened_by INT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TABLE document_notes (
      id SERIAL PRIMARY KEY,
      thread_id INT NOT NULL REFERENCES document_threads(id) ON DELETE CASCADE,
      author_id INT REFERENCES users(id) ON DELETE SET NULL,
      body VARCHAR(2000) NOT NULL CHECK (length(trim(body)) > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX document_notes_thread_idx ON document_notes (thread_id, id)`.execute(db);
  await sql`CREATE INDEX document_threads_open_idx ON document_threads (updated_at) WHERE status = 'open'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS document_notes`.execute(db);
  await sql`DROP TABLE IF EXISTS document_threads`.execute(db);
  await sql`ALTER TABLE supplier_bills DROP COLUMN IF EXISTS vat_month`.execute(db);
  await sql`DROP TABLE IF EXISTS vat_months`.execute(db);

  await sql`UPDATE suppliers SET usual_vat_rate = 18 WHERE usual_vat_rate = 16`.execute(db);
  await sql`ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_usual_vat_rate_check`.execute(db);
  await sql`
    ALTER TABLE suppliers
      DROP COLUMN usual_vat_exempt,
      ADD CONSTRAINT suppliers_usual_vat_rate_check CHECK (usual_vat_rate IN (0, 8, 18))
  `.execute(db);
  await sql`ALTER TABLE document_lines DROP COLUMN IF EXISTS vat_exempt`.execute(db);
  for (const table of RATED_TABLES) {
    // 16% was the old standard rate; it goes back as 18% rather than failing.
    await sql`UPDATE ${sql.table(table)} SET vat_rate = 18 WHERE vat_rate = 16`.execute(db);
    await sql`
      ALTER TABLE ${sql.table(table)}
        DROP CONSTRAINT IF EXISTS ${sql.raw(`${table}_vat_exempt_check`)},
        DROP COLUMN vat_exempt,
        DROP CONSTRAINT IF EXISTS ${sql.raw(`${table}_vat_rate_check`)},
        ADD CONSTRAINT ${sql.raw(`${table}_vat_rate_check`)} CHECK (vat_rate IN (0, 8, 18))
    `.execute(db);
  }

  // An accountant goes back to browsing only.
  await sql`UPDATE users SET role = 'family' WHERE role = 'accountant'`.execute(db);
  await sql`UPDATE invites SET role = 'family' WHERE role = 'accountant'`.execute(db);
  for (const table of ['users', 'invites']) {
    await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT IF EXISTS ${sql.raw(`${table}_role_check`)}`.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} ADD CONSTRAINT ${sql.raw(`${table}_role_check`)} CHECK (role IN ${ROLES_BEFORE})`.execute(db);
  }
}
