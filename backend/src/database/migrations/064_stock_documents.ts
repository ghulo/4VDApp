import { type Kysely, sql } from 'kysely';

/**
 * Stock in and stock out documents: goods coming in or going out without a
 * bill or a sale (found in the back, received free, used in the shop, given
 * away). Each one is numbered, moves the stock of its lines and writes one
 * entry in the books at cost. A saved document is never edited: it is voided,
 * which puts the stock back and reverses its entry. Each line's cost is the
 * product's cost when it was saved, so its entry never moves under it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE stock_documents (
      id SERIAL PRIMARY KEY,
      number VARCHAR(40) NOT NULL UNIQUE,
      direction VARCHAR(3) NOT NULL CHECK (direction IN ('in', 'out')),
      reason VARCHAR(20) NOT NULL CHECK (reason IN ('found', 'received_free', 'own_use', 'given_away', 'other')),
      day DATE NOT NULL,
      note TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_at TIMESTAMPTZ,
      voided_by INT REFERENCES users(id) ON DELETE SET NULL
    )
  `.execute(db);
  await sql`CREATE INDEX stock_documents_day_idx ON stock_documents (day)`.execute(db);
  await sql`
    CREATE TABLE stock_document_lines (
      id SERIAL PRIMARY KEY,
      document_id INT NOT NULL REFERENCES stock_documents(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id),
      quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
      unit_cost NUMERIC(12, 2) CHECK (unit_cost >= 0)
    )
  `.execute(db);
  await sql`CREATE INDEX stock_document_lines_document_idx ON stock_document_lines (document_id)`.execute(db);
  await sql`
    CREATE TRIGGER stock_documents_ledger AFTER INSERT OR UPDATE OR DELETE ON stock_documents
    FOR EACH ROW EXECUTE FUNCTION ledger_enqueue('stock_documents', 'id')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM ledger_queue WHERE source_table = 'stock_documents'`.execute(db);
  await sql`DROP TABLE IF EXISTS stock_document_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS stock_documents`.execute(db);
}
