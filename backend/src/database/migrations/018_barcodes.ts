import { type Kysely, sql } from 'kysely';

/**
 * A barcode per product: the manufacturer's, scanned or typed in, or one the
 * shop makes. Scanning it at the counter finds the product, so no two live
 * products may share one.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE products ADD COLUMN barcode VARCHAR(64)`.execute(db);
  await sql`CREATE UNIQUE INDEX idx_products_barcode_active ON products (barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_products_barcode_active`.execute(db);
  await sql`ALTER TABLE products DROP COLUMN IF EXISTS barcode`.execute(db);
}
