import { type Kysely, sql } from 'kysely';

/**
 * TREFIN's cash desk and bank: bills it paid and invoices it collected from
 * the cash desk (or a bank), and its bank statements' lines. History only:
 * they count in no balance and post nothing (4VD's opening balances already
 * hold where TREFIN ended). Each place's book in Money lists them with a tag.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE trefin_money_lines (
      id SERIAL PRIMARY KEY,
      trefin_ref VARCHAR(80) NOT NULL UNIQUE,
      -- 'till' (TREFIN's cash desk) or 'bank'
      place VARCHAR(10) NOT NULL CHECK (place IN ('till', 'bank')),
      -- The bank as TREFIN named it, when it said
      bank_name VARCHAR(120),
      moved_on DATE NOT NULL,
      -- 'supplier_payment', 'customer_payment' or 'bank_payment' (a bank statement's line)
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('supplier_payment', 'customer_payment', 'bank_payment')),
      number VARCHAR(40),
      -- Money in above zero, money out below
      amount NUMERIC(12, 2) NOT NULL,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      party_name VARCHAR(200),
      -- The bill or invoice paid, as TREFIN wrote it
      document VARCHAR(120),
      -- A statement line's account in the chart of accounts, and its words
      account VARCHAR(10),
      description TEXT
    )
  `.execute(db);
  await sql`CREATE INDEX trefin_money_lines_place_idx ON trefin_money_lines (place, moved_on)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS trefin_money_lines`.execute(db);
}
