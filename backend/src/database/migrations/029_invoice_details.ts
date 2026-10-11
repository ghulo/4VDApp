import { type Kysely, sql } from 'kysely';

/**
 * What a full invoice says beyond its lines: the rabat given at the counter
 * (kept on the sale and copied to the invoice line), how it is paid (at the
 * till, or on the customer's account with a due date), and a note the shop
 * prints at the bottom of every invoice.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE sales
      ADD COLUMN discount_percent NUMERIC(5, 2) CHECK (discount_percent > 0 AND discount_percent <= 100),
      ADD COLUMN price_before_discount NUMERIC(10, 2),
      ADD CONSTRAINT sales_discount_together CHECK ((discount_percent IS NULL) = (price_before_discount IS NULL))
  `.execute(db);
  await sql`
    ALTER TABLE document_lines
      ADD COLUMN discount_percent NUMERIC(5, 2),
      ADD COLUMN price_before_discount NUMERIC(10, 2)
  `.execute(db);
  await sql`
    ALTER TABLE documents
      ADD COLUMN payment_method VARCHAR(20) NOT NULL DEFAULT 'till' CHECK (payment_method IN ('till', 'account')),
      ADD COLUMN due_date DATE
  `.execute(db);
  // Invoices that went on a customer's tab were paid on account.
  await sql`UPDATE documents SET payment_method = 'account' WHERE kind = 'invoice' AND customer_id IS NOT NULL`.execute(db);
  await sql`ALTER TABLE businesses ADD COLUMN invoice_note VARCHAR(500)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE businesses DROP COLUMN IF EXISTS invoice_note`.execute(db);
  await sql`ALTER TABLE documents DROP COLUMN IF EXISTS payment_method, DROP COLUMN IF EXISTS due_date`.execute(db);
  await sql`ALTER TABLE document_lines DROP COLUMN IF EXISTS discount_percent, DROP COLUMN IF EXISTS price_before_discount`.execute(db);
  await sql`
    ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_discount_together,
      DROP COLUMN IF EXISTS discount_percent, DROP COLUMN IF EXISTS price_before_discount
  `.execute(db);
}
