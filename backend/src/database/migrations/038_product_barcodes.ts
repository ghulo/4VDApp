import { type Kysely, sql } from 'kysely';

/**
 * More barcodes for one product. A supplier can ship the same item under 3 or
 * 4 barcodes (a new pack, another factory, an import), and each one should
 * find the product at the counter. `products.barcode` stays the main one, the
 * one labels print; these are the others. A barcode belongs to one product at
 * a time, main or other: the app checks both, and this index stops two
 * products' other barcodes clashing.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE product_barcodes (
      id SERIAL PRIMARY KEY,
      product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      barcode VARCHAR(64) NOT NULL UNIQUE,
      added_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX product_barcodes_product_idx ON product_barcodes (product_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS product_barcodes`.execute(db);
}
