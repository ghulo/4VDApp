import { type Kysely, sql } from 'kysely';

/**
 * Sales documents: every checkout issues a numbered invoice, and every reversal
 * (an undone sale, an approved return) a credit note pointing back at it.
 * A document never changes once issued: it keeps its own copy of the shop,
 * the buyer and every line, so later edits to products or the profile don't
 * rewrite history. The only field set afterwards is the fiscal receipt number,
 * which links the document to the receipt the shop's fiscal printer gave.
 *
 * Numbers run per kind and year with no gaps (F-2026-000001, K-2026-000001):
 * `document_numbers` holds the last one, and taking the next locks its row.
 *
 * Products get a VAT rate (Kosovo: 18% standard, 8% reduced, 0%). Prices are
 * VAT-inclusive, so each line splits its total into net and VAT.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE products ADD COLUMN vat_rate SMALLINT NOT NULL DEFAULT 18 CHECK (vat_rate IN (0, 8, 18))`.execute(db);

  await sql`
    CREATE TABLE document_numbers (
      kind VARCHAR(12) NOT NULL,
      year SMALLINT NOT NULL,
      last_number INT NOT NULL,
      PRIMARY KEY (kind, year)
    )
  `.execute(db);

  await sql`
    CREATE TABLE documents (
      id SERIAL PRIMARY KEY,
      kind VARCHAR(12) NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
      number VARCHAR(20) NOT NULL UNIQUE,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      issued_by INT REFERENCES users(id),
      seller JSONB NOT NULL,
      customer_id INT REFERENCES customers(id),
      buyer JSONB,
      corrects_id INT REFERENCES documents(id),
      reason TEXT,
      net_total NUMERIC(12, 2) NOT NULL,
      vat_total NUMERIC(12, 2) NOT NULL,
      total NUMERIC(12, 2) NOT NULL,
      fiscal_receipt_no VARCHAR(40),
      CHECK ((kind = 'credit_note') = (corrects_id IS NOT NULL))
    )
  `.execute(db);
  await sql`CREATE INDEX idx_documents_issued ON documents (issued_at DESC)`.execute(db);

  await sql`
    CREATE TABLE document_lines (
      id SERIAL PRIMARY KEY,
      document_id INT NOT NULL REFERENCES documents(id),
      sale_id INT NOT NULL REFERENCES sales(id),
      return_id INT REFERENCES returns(id),
      product_name VARCHAR(255) NOT NULL,
      quantity INT NOT NULL CHECK (quantity > 0),
      unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
      vat_rate SMALLINT NOT NULL,
      net_amount NUMERIC(12, 2) NOT NULL,
      vat_amount NUMERIC(12, 2) NOT NULL,
      total NUMERIC(12, 2) NOT NULL
    )
  `.execute(db);
  await sql`CREATE INDEX idx_document_lines_document ON document_lines (document_id)`.execute(db);
  await sql`CREATE INDEX idx_document_lines_sale ON document_lines (sale_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS document_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS documents`.execute(db);
  await sql`DROP TABLE IF EXISTS document_numbers`.execute(db);
  await sql`ALTER TABLE products DROP COLUMN IF EXISTS vat_rate`.execute(db);
}
