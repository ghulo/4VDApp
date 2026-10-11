import { type Kysely, sql } from 'kysely';
import { countryFromBarcode } from '../../utils/barcodeCountry.js';

/**
 * The country a product comes from (ISO code), shown as a flag in the app and
 * on labels. Starts from the barcode's prefix; people can correct it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE products ADD COLUMN origin_country CHAR(2) CHECK (origin_country ~ '^[A-Z]{2}$')`.execute(db);
  const { rows } = await sql<{ id: number; barcode: string }>`SELECT id, barcode FROM products WHERE barcode IS NOT NULL`.execute(db);
  for (const row of rows) {
    const country = countryFromBarcode(row.barcode);
    if (country) await sql`UPDATE products SET origin_country = ${country} WHERE id = ${row.id}`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE products DROP COLUMN IF EXISTS origin_country`.execute(db);
}
