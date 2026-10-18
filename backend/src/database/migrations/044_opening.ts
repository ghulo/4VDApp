import { type Kysely, sql } from 'kysely';

/**
 * Moving over from TREFIN: what the shop has and owes on the day the books
 * start, line by line, each one confirmed by a person before it is posted.
 *
 * - `opening_lines`: one row per place money is kept, the stock, each supplier
 *   and customer with a balance, and any other account (VAT, fixed assets…).
 *   Money places and other accounts keep a typed `amount`; stock and partner
 *   lines work theirs out (stock × cost, brought-over bills and tab charges),
 *   so they can't disagree with what the rest of 4VD shows. A line is confirmed
 *   while `confirmed_amount` still equals its amount.
 * - Suppliers and customers get the partner code they had in TREFIN, so the
 *   balances can be matched (the import wrote it into their note).
 * - A supplier bill can be "brought over": an open bill from before the books
 *   start (and a customer's tab charge the same way). It stays out of the books (the opening entry carries the debt) and
 *   out of the VAT return, but shows as owed and can be paid like any bill.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of ['suppliers', 'customers']) {
    await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN external_code VARCHAR(40)`.execute(db);
    await sql`
      UPDATE ${sql.table(table)} SET external_code = substring(note from 'TREFIN code ([0-9A-Za-z_-]+)')
      WHERE note ~ 'TREFIN code [0-9A-Za-z_-]+'
    `.execute(db);
    await sql`CREATE INDEX ${sql.raw(`${table}_external_code_idx`)} ON ${sql.table(table)} (external_code) WHERE external_code IS NOT NULL`.execute(db);
  }

  await sql`ALTER TABLE supplier_bills ADD COLUMN brought_over BOOLEAN NOT NULL DEFAULT false`.execute(db);
  await sql`ALTER TABLE tab_entries ADD COLUMN brought_over BOOLEAN NOT NULL DEFAULT false`.execute(db);

  await sql`
    CREATE TABLE opening_lines (
      id SERIAL PRIMARY KEY,
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('place', 'stock', 'supplier', 'customer', 'account')),
      account_id INT REFERENCES ledger_accounts(id),
      place_id INT REFERENCES money_places(id) ON DELETE CASCADE,
      supplier_id INT REFERENCES suppliers(id) ON DELETE CASCADE,
      customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
      -- Debits minus credits as typed (always for places and other accounts; for a partner only when it has
      -- no brought-over bills or charges, e.g. a supplier paid ahead); null: worked out.
      amount NUMERIC(14, 2),
      -- What TREFIN said on the day before the books start (debits minus credits); null: not loaded or not in TREFIN.
      trefin_amount NUMERIC(14, 2),
      source VARCHAR(10) NOT NULL DEFAULT 'typed' CHECK (source IN ('trefin', 'counted', 'statement', 'stock', 'typed')),
      note VARCHAR(300),
      confirmed_amount NUMERIC(14, 2),
      confirmed_by INT REFERENCES users(id) ON DELETE SET NULL,
      confirmed_at TIMESTAMPTZ,
      updated_by INT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK ((kind = 'place') = (place_id IS NOT NULL)),
      CHECK ((kind = 'supplier') = (supplier_id IS NOT NULL)),
      CHECK ((kind = 'customer') = (customer_id IS NOT NULL)),
      CHECK (kind <> 'account' OR account_id IS NOT NULL),
      CHECK (kind NOT IN ('place', 'account') OR amount IS NOT NULL),
      CHECK (kind <> 'stock' OR amount IS NULL),
      CHECK ((confirmed_at IS NULL) = (confirmed_amount IS NULL))
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX opening_lines_place_idx ON opening_lines (place_id) WHERE place_id IS NOT NULL`.execute(db);
  await sql`CREATE UNIQUE INDEX opening_lines_supplier_idx ON opening_lines (supplier_id) WHERE supplier_id IS NOT NULL`.execute(db);
  await sql`CREATE UNIQUE INDEX opening_lines_customer_idx ON opening_lines (customer_id) WHERE customer_id IS NOT NULL`.execute(db);
  await sql`CREATE UNIQUE INDEX opening_lines_account_idx ON opening_lines (account_id) WHERE kind = 'account'`.execute(db);
  await sql`CREATE UNIQUE INDEX opening_lines_stock_idx ON opening_lines ((true)) WHERE kind = 'stock'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM settings WHERE key IN ('opening_posted', 'opening_trefin_loaded')`.execute(db);
  await sql`DROP TABLE IF EXISTS opening_lines`.execute(db);
  await sql`ALTER TABLE tab_entries DROP COLUMN IF EXISTS brought_over`.execute(db);
  await sql`ALTER TABLE supplier_bills DROP COLUMN IF EXISTS brought_over`.execute(db);
  for (const table of ['suppliers', 'customers']) {
    await sql`ALTER TABLE ${sql.table(table)} DROP COLUMN IF EXISTS external_code`.execute(db);
  }
}
