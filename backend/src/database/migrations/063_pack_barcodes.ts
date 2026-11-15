import { type Kysely, sql } from 'kysely';

/**
 * A pack barcode: a box or shrink pack of 6, 12 or 24 printed with a barcode of
 * its own. Scanning it adds that many pieces. Its price is an ordinary bulk
 * price for that many, so one place holds every price. Null: a single piece.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE product_barcodes ADD COLUMN pack_size INT CHECK (pack_size IS NULL OR pack_size BETWEEN 2 AND 1000)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE product_barcodes DROP COLUMN IF EXISTS pack_size`.execute(db);
}
