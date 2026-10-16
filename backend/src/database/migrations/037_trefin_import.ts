import { type Kysely, sql } from 'kysely';

/**
 * What bringing a shop over from TREFIN needs: the old till's receipt number on
 * each imported sale, so the lines of one receipt show as one checkout, and a
 * list of products that look like the same item twice, for someone to review.
 * Also an index for "when did this product last sell": with years of history
 * Postgres otherwise walks every sale by date for each product (34s, not 9ms).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sales ADD COLUMN receipt_no VARCHAR(40)`.execute(db);
  await sql`CREATE INDEX sales_product_date_idx ON sales (product_id, sale_date) WHERE undone_at IS NULL`.execute(db);
  await sql`CREATE INDEX sales_receipt_no_idx ON sales (receipt_no) WHERE receipt_no IS NOT NULL`.execute(db);
  await sql`
    CREATE TABLE product_duplicate_flags (
      id SERIAL PRIMARY KEY,
      product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      other_product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      reason VARCHAR(40) NOT NULL,
      similarity NUMERIC(4, 3),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ,
      resolved_by INT REFERENCES users(id) ON DELETE SET NULL,
      resolution VARCHAR(20) CHECK (resolution IN ('merged', 'kept_both')),
      CHECK (product_id <> other_product_id),
      CHECK ((resolved_at IS NULL) = (resolution IS NULL)),
      UNIQUE (product_id, other_product_id)
    )
  `.execute(db);
  await sql`CREATE INDEX product_duplicate_flags_open_idx ON product_duplicate_flags (created_at) WHERE resolved_at IS NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS product_duplicate_flags`.execute(db);
  await sql`DROP INDEX IF EXISTS sales_receipt_no_idx`.execute(db);
  await sql`DROP INDEX IF EXISTS sales_product_date_idx`.execute(db);
  await sql`ALTER TABLE sales DROP COLUMN IF EXISTS receipt_no`.execute(db);
}
