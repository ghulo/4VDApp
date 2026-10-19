import { type Kysely, sql } from 'kysely';

/**
 * TREFIN's own stock documents: each database's starting stock, stock
 * corrections and counts (its sales and purchases came in as sales and
 * bills). History only: they never move stock here and post nothing. Stock
 * counts lists the documents; each product's stock tab shows its lines.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE trefin_stock_documents (
      id SERIAL PRIMARY KEY,
      trefin_ref VARCHAR(80) NOT NULL UNIQUE,
      -- 'opening' (a database's starting stock), 'correction' or 'count'
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('opening', 'correction', 'count')),
      number VARCHAR(40),
      dated DATE NOT NULL,
      -- Which TREFIN database (MARKET_2025, MARKET_2022, MARKET_2022_FINAL_2023_05_26); the dashboard says it in words
      source VARCHAR(120) NOT NULL
    )
  `.execute(db);
  await sql`
    CREATE TABLE trefin_stock_lines (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES trefin_stock_documents(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name VARCHAR(200) NOT NULL,
      -- Starting stock, the correction, or the count's difference
      quantity NUMERIC(14, 3) NOT NULL,
      -- What a count found
      counted NUMERIC(14, 3),
      unit_cost NUMERIC(12, 4)
    )
  `.execute(db);
  await sql`CREATE INDEX trefin_stock_lines_document_idx ON trefin_stock_lines (document_id)`.execute(db);
  await sql`CREATE INDEX trefin_stock_lines_product_idx ON trefin_stock_lines (product_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS trefin_stock_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS trefin_stock_documents`.execute(db);
}
