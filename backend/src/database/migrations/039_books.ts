import { type Kysely, sql } from 'kysely';
import { seedBooks } from '../books.js';

/** The posting tables as they were when the books started (later migrations add and remove some). */
const POSTING_TABLES = [
  'sales',
  'document_lines',
  'returns',
  'write_offs',
  'stock_count_lines',
  'stock_adjustments',
  'supplier_bills',
  'supplier_payments',
  'expenses',
  'tab_entries',
] as const;

/**
 * The books underneath: a chart of accounts (TREFIN's, as the accountant uses
 * it), which account each kind of movement posts to, and the entries.
 *
 * Entries are written by 4VD, not by people: every sale, return, bill,
 * payment, expense, write-off and count posts its own. A trigger on each of
 * those tables queues the changed row, and the books post the queue before
 * anyone reads them, so no code path that changes a document can forget to.
 * A changed or undone document never edits its entry: the old one is reversed
 * and a new one written, so the trail stays.
 *
 * The books start on `books_start` (a setting): documents dated before it stay
 * in reports but are not posted; TREFIN's balances on that day come in as the
 * opening entry. It starts today; the launch sets it to the launch day.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE ledger_accounts (
      id SERIAL PRIMARY KEY,
      number VARCHAR(10) NOT NULL UNIQUE CHECK (number ~ '^[0-9]{3,10}$'),
      name VARCHAR(200) NOT NULL,
      class VARCHAR(20) NOT NULL CHECK (class IN ('asset', 'liability', 'equity', 'revenue', 'cost_of_sales', 'expense', 'other_income', 'other_expense')),
      type_name VARCHAR(100) NOT NULL,
      group_name VARCHAR(200) NOT NULL,
      cash_flow VARCHAR(10) NOT NULL DEFAULT 'operating' CHECK (cash_flow IN ('operating', 'investing', 'financing')),
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TABLE ledger_links (
      key VARCHAR(40) PRIMARY KEY,
      account_id INT NOT NULL REFERENCES ledger_accounts(id)
    )
  `.execute(db);
  await sql`
    CREATE TABLE ledger_entries (
      id SERIAL PRIMARY KEY,
      entry_date DATE NOT NULL,
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('auto', 'manual', 'reversal')),
      -- What posted it, e.g. 'bill:12' or a sale checkout 'checkout:i40'; null for manual entries.
      source_key VARCHAR(80),
      description VARCHAR(500) NOT NULL,
      -- Something the books could not post as it should, said in words (e.g. a product with no cost).
      warning VARCHAR(500),
      -- The lines in a stable form, to tell whether a document's entry is still right.
      fingerprint TEXT,
      reverses_id INT REFERENCES ledger_entries(id),
      reversed_at TIMESTAMPTZ,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK ((kind = 'reversal') = (reverses_id IS NOT NULL)),
      CHECK ((kind = 'manual') = (source_key IS NULL) OR kind = 'reversal')
    )
  `.execute(db);
  await sql`CREATE INDEX ledger_entries_date_idx ON ledger_entries (entry_date, id)`.execute(db);
  await sql`CREATE INDEX ledger_entries_source_idx ON ledger_entries (source_key) WHERE source_key IS NOT NULL`.execute(db);
  await sql`
    CREATE TABLE ledger_lines (
      id SERIAL PRIMARY KEY,
      entry_id INT NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
      account_id INT NOT NULL REFERENCES ledger_accounts(id),
      debit NUMERIC(14, 2) NOT NULL DEFAULT 0,
      credit NUMERIC(14, 2) NOT NULL DEFAULT 0,
      supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
      customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
      memo VARCHAR(300),
      CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0) AND debit + credit > 0)
    )
  `.execute(db);
  await sql`CREATE INDEX ledger_lines_entry_idx ON ledger_lines (entry_id)`.execute(db);
  await sql`CREATE INDEX ledger_lines_account_idx ON ledger_lines (account_id, entry_id)`.execute(db);

  // Rows changed since the books last posted. `row_id` is the row's id, or for
  // invoice lines the sale they are about.
  await sql`
    CREATE TABLE ledger_queue (
      source_table VARCHAR(40) NOT NULL,
      row_id INT NOT NULL,
      queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (source_table, row_id)
    )
  `.execute(db);
  await sql`
    CREATE FUNCTION ledger_enqueue() RETURNS trigger AS $$
    DECLARE
      row_data JSONB := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
    BEGIN
      INSERT INTO ledger_queue (source_table, row_id)
      VALUES (TG_ARGV[0], (row_data ->> TG_ARGV[1])::int)
      ON CONFLICT DO NOTHING;
      RETURN NULL;
    END
    $$ LANGUAGE plpgsql
  `.execute(db);
  for (const table of POSTING_TABLES) {
    // An invoice line regroups its sale into the invoice's checkout.
    const [queueAs, idColumn] = table === 'document_lines' ? ['sales', 'sale_id'] : [table, 'id'];
    await sql`
      CREATE TRIGGER ${sql.raw(`${table}_ledger`)} AFTER INSERT OR UPDATE OR DELETE ON ${sql.table(table)}
      FOR EACH ROW EXECUTE FUNCTION ledger_enqueue(${sql.lit(queueAs)}, ${sql.lit(idColumn)})
    `.execute(db);
  }

  // The VAT on a supplier's bill, so it can be claimed back; null when not entered.
  await sql`ALTER TABLE supplier_bills ADD COLUMN vat_amount NUMERIC(12, 2) CHECK (vat_amount >= 0)`.execute(db);

  await seedBooks(db);
  await sql`
    INSERT INTO settings (key, value) VALUES ('books_start', to_jsonb(current_date::text))
    ON CONFLICT (key) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM settings WHERE key = 'books_start'`.execute(db);
  await sql`ALTER TABLE supplier_bills DROP COLUMN IF EXISTS vat_amount`.execute(db);
  for (const table of POSTING_TABLES) {
    await sql`DROP TRIGGER IF EXISTS ${sql.raw(`${table}_ledger`)} ON ${sql.table(table)}`.execute(db);
  }
  await sql`DROP FUNCTION IF EXISTS ledger_enqueue()`.execute(db);
  await sql`DROP TABLE IF EXISTS ledger_queue`.execute(db);
  await sql`DROP TABLE IF EXISTS ledger_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS ledger_entries`.execute(db);
  await sql`DROP TABLE IF EXISTS ledger_links`.execute(db);
  await sql`DROP TABLE IF EXISTS ledger_accounts`.execute(db);
}
