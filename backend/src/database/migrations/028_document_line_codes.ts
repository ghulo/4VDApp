import { type Kysely, sql } from 'kysely';

/**
 * Each document line keeps the product's code (its barcode, else its SKU) as
 * it was when issued, so the printed invoice says which product it was and
 * scanning or typing the code finds it. Lines issued before get today's code.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE document_lines ADD COLUMN product_code VARCHAR(100)`.execute(db);
  await sql`
    UPDATE document_lines l
    SET product_code = coalesce(p.barcode, p.sku)
    FROM sales s JOIN products p ON p.id = s.product_id
    WHERE s.id = l.sale_id
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE document_lines DROP COLUMN IF EXISTS product_code`.execute(db);
}
