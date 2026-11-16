import { type Kysely, sql } from 'kysely';

/**
 * Serial numbers on the products marked for them (appliances, phones, tools),
 * with how many months of warranty the shop gives. A serial is recorded when
 * it comes in (optional: bill, delivery, stock in) or typed at the sale.
 * Selling it stamps the sale, invoice, customer and warranty end; a return or
 * an undone sale puts it back in stock but keeps that last sale to look up.
 * Unique per product, so one serial can never be sold twice at once.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE products
      ADD COLUMN has_serials BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN warranty_months SMALLINT CHECK (warranty_months IS NULL OR warranty_months BETWEEN 0 AND 120)
  `.execute(db);
  await sql`
    CREATE TABLE serials (
      id SERIAL PRIMARY KEY,
      product_id INT NOT NULL REFERENCES products(id),
      serial VARCHAR(80) NOT NULL,
      status VARCHAR(8) NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'sold')),
      bill_id INT REFERENCES supplier_bills(id) ON DELETE SET NULL,
      stock_document_id INT REFERENCES stock_documents(id) ON DELETE SET NULL,
      order_id INT REFERENCES purchase_orders(id) ON DELETE SET NULL,
      came_on DATE,
      sale_id INT REFERENCES sales(id) ON DELETE SET NULL,
      document_id INT REFERENCES documents(id) ON DELETE SET NULL,
      customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
      sold_at TIMESTAMPTZ,
      warranty_ends DATE,
      returned_at TIMESTAMPTZ,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX serials_product_serial_idx ON serials (product_id, lower(serial))`.execute(db);
  await sql`CREATE INDEX serials_serial_idx ON serials (lower(serial))`.execute(db);
  await sql`CREATE INDEX serials_sale_idx ON serials (sale_id) WHERE sale_id IS NOT NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS serials`.execute(db);
  await sql`ALTER TABLE products DROP COLUMN IF EXISTS has_serials, DROP COLUMN IF EXISTS warranty_months`.execute(db);
}
