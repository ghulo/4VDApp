import { type Kysely, sql } from 'kysely';

/**
 * Step 10, partners: a firm that is both a customer and a supplier, extra
 * addresses, and a yearly bonus.
 *
 * - `partner_addresses`: more addresses for a customer or a supplier (a
 *   delivery site, a branch); the main one stays on the customer/supplier row.
 * - `customers.bonus_percent`: the bonus a customer earns on what they bought
 *   in a year; `bonus_payouts` is each year's bonus, paid once as a credit on
 *   their tab.
 * - `partner_offsets`: a set-off (kompensim) between what a firm owes the shop
 *   as a customer and what the shop owes it as a supplier.
 * - Tab entries get a `credit` kind: what they owe goes down without money
 *   moving (an offset or a bonus), so the till and cash counts leave it alone.
 *   Supplier payments get an `offset` method for the same reason.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE partner_addresses (
      id SERIAL PRIMARY KEY,
      customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
      supplier_id INT REFERENCES suppliers(id) ON DELETE CASCADE,
      label VARCHAR(60) NOT NULL,
      address VARCHAR(300) NOT NULL,
      city VARCHAR(100),
      note VARCHAR(300),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK ((customer_id IS NULL) <> (supplier_id IS NULL))
    )
  `.execute(db);
  await sql`CREATE INDEX partner_addresses_customer_idx ON partner_addresses (customer_id)`.execute(db);
  await sql`CREATE INDEX partner_addresses_supplier_idx ON partner_addresses (supplier_id)`.execute(db);

  await sql`ALTER TABLE customers ADD COLUMN bonus_percent NUMERIC(5, 2) CHECK (bonus_percent > 0 AND bonus_percent <= 50)`.execute(db);

  await sql`
    CREATE TABLE partner_offsets (
      id SERIAL PRIMARY KEY,
      customer_id INT NOT NULL REFERENCES customers(id),
      supplier_id INT NOT NULL REFERENCES suppliers(id),
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      day DATE NOT NULL,
      note VARCHAR(300),
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TABLE bonus_payouts (
      id SERIAL PRIMARY KEY,
      customer_id INT NOT NULL REFERENCES customers(id),
      year INT NOT NULL,
      bought NUMERIC(12, 2) NOT NULL,
      percent NUMERIC(5, 2) NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      day DATE NOT NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (customer_id, year)
    )
  `.execute(db);

  await sql`ALTER TABLE tab_entries DROP CONSTRAINT tab_entries_kind_check`.execute(db);
  await sql`ALTER TABLE tab_entries ADD CONSTRAINT tab_entries_kind_check CHECK (kind IN ('charge', 'payment', 'refund', 'credit'))`.execute(db);
  await sql`
    ALTER TABLE tab_entries
      ADD COLUMN offset_id INT REFERENCES partner_offsets(id),
      ADD COLUMN bonus_id INT REFERENCES bonus_payouts(id)
  `.execute(db);

  await sql`ALTER TABLE supplier_payments DROP CONSTRAINT supplier_payments_method_check`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_method_check CHECK (method IN ('drawer', 'cash', 'bank', 'credit', 'offset'))`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN offset_id INT REFERENCES partner_offsets(id)`.execute(db);
  // Neither a credit nor an offset comes out of a place.
  await sql`ALTER TABLE supplier_payments DROP CONSTRAINT supplier_payments_place_check`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_place_check CHECK ((method IN ('credit', 'offset')) = (place_id IS NULL))`.execute(db);

  // Each posts its own entry in the books.
  for (const table of ['partner_offsets', 'bonus_payouts']) {
    await sql`
      CREATE TRIGGER ${sql.raw(`${table}_ledger`)} AFTER INSERT OR UPDATE OR DELETE ON ${sql.table(table)}
      FOR EACH ROW EXECUTE FUNCTION ledger_enqueue(${sql.lit(table)}, 'id')
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM supplier_payments WHERE method = 'offset'`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN offset_id`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP CONSTRAINT supplier_payments_place_check`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_place_check CHECK ((method = 'credit') = (place_id IS NULL))`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP CONSTRAINT supplier_payments_method_check`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_method_check CHECK (method IN ('drawer', 'cash', 'bank', 'credit'))`.execute(db);
  await sql`ALTER TABLE tab_entries DROP COLUMN offset_id, DROP COLUMN bonus_id`.execute(db);
  await sql`DELETE FROM tab_entries WHERE kind = 'credit'`.execute(db);
  await sql`ALTER TABLE tab_entries DROP CONSTRAINT tab_entries_kind_check`.execute(db);
  await sql`ALTER TABLE tab_entries ADD CONSTRAINT tab_entries_kind_check CHECK (kind IN ('charge', 'payment', 'refund'))`.execute(db);
  await sql`DROP TABLE bonus_payouts`.execute(db);
  await sql`DROP TABLE partner_offsets`.execute(db);
  await sql`ALTER TABLE customers DROP COLUMN bonus_percent`.execute(db);
  await sql`DROP TABLE partner_addresses`.execute(db);
}
