import { type Kysely, sql } from 'kysely';

/**
 * TREFIN's whole history, brought into 4VD's own lists to look at.
 *
 * - `supplier_bills.trefin_ref`: "<database>/<document id>" for a bill taken
 *   from TREFIN. Such a bill is history only: it never moved stock here, is
 *   never posted to the books, never counts in a VAT month, is never owed and
 *   can't be changed. It may total 0 (TREFIN kept empty documents) and a
 *   return to the supplier may stand on its own, without the bill it corrects.
 * - Suppliers and customers get the details TREFIN kept for them as real
 *   fields: address, city, business no. (NRB), fiscal no., VAT no., IBAN,
 *   contact person and mobile; customers also a credit limit and discount.
 * - `products.wholesale_price`: the price a business pays, with VAT (TREFIN's
 *   "invoice" price list); null: the shelf price.
 *
 * Sales from TREFIN are already known by their receipt number (`receipt_no`).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE supplier_bills ADD COLUMN trefin_ref VARCHAR(80)`.execute(db);
  await sql`CREATE UNIQUE INDEX supplier_bills_trefin_ref_idx ON supplier_bills (trefin_ref) WHERE trefin_ref IS NOT NULL`.execute(db);
  await sql`
    ALTER TABLE supplier_bills
      DROP CONSTRAINT supplier_bills_amount_check,
      ADD CONSTRAINT supplier_bills_amount_check CHECK (amount > 0 OR (trefin_ref IS NOT NULL AND amount >= 0)),
      DROP CONSTRAINT supplier_bills_credit_check,
      ADD CONSTRAINT supplier_bills_credit_check CHECK ((kind = 'credit') = (credit_for_id IS NOT NULL) OR (trefin_ref IS NOT NULL AND credit_for_id IS NULL))
  `.execute(db);

  for (const table of ['suppliers', 'customers']) {
    await sql`
      ALTER TABLE ${sql.table(table)}
        ADD COLUMN address VARCHAR(200),
        ADD COLUMN city VARCHAR(80),
        ADD COLUMN business_no VARCHAR(40),
        ADD COLUMN fiscal_no VARCHAR(40),
        ADD COLUMN vat_no VARCHAR(40),
        ADD COLUMN iban VARCHAR(60),
        ADD COLUMN contact_person VARCHAR(120),
        ADD COLUMN mobile VARCHAR(40)
    `.execute(db);
  }
  await sql`
    ALTER TABLE customers
      ADD COLUMN credit_limit NUMERIC(12, 2) CHECK (credit_limit > 0),
      ADD COLUMN discount_percent NUMERIC(5, 2) CHECK (discount_percent > 0 AND discount_percent <= 100)
  `.execute(db);

  await sql`ALTER TABLE products ADD COLUMN wholesale_price NUMERIC(12, 2) CHECK (wholesale_price >= 0)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE products DROP COLUMN IF EXISTS wholesale_price`.execute(db);
  await sql`ALTER TABLE customers DROP COLUMN IF EXISTS credit_limit, DROP COLUMN IF EXISTS discount_percent`.execute(db);
  for (const table of ['suppliers', 'customers']) {
    await sql`
      ALTER TABLE ${sql.table(table)}
        DROP COLUMN IF EXISTS address, DROP COLUMN IF EXISTS city, DROP COLUMN IF EXISTS business_no, DROP COLUMN IF EXISTS fiscal_no,
        DROP COLUMN IF EXISTS vat_no, DROP COLUMN IF EXISTS iban, DROP COLUMN IF EXISTS contact_person, DROP COLUMN IF EXISTS mobile
    `.execute(db);
  }
  await sql`DELETE FROM supplier_bills WHERE trefin_ref IS NOT NULL`.execute(db);
  await sql`
    ALTER TABLE supplier_bills
      DROP CONSTRAINT supplier_bills_credit_check,
      ADD CONSTRAINT supplier_bills_credit_check CHECK ((kind = 'credit') = (credit_for_id IS NOT NULL)),
      DROP CONSTRAINT supplier_bills_amount_check,
      ADD CONSTRAINT supplier_bills_amount_check CHECK (amount > 0)
  `.execute(db);
  await sql`ALTER TABLE supplier_bills DROP COLUMN IF EXISTS trefin_ref`.execute(db);
}
