import { type Kysely, sql } from 'kysely';

/**
 * The last of TREFIN's history: its offers (price quotes printed for a
 * customer, on the Offers page) and its activity log (in Activity, people by
 * name only). Look-only: nothing here changes stock, money or the books.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE trefin_offers (
      id SERIAL PRIMARY KEY,
      trefin_ref VARCHAR(80) NOT NULL UNIQUE,
      number VARCHAR(40),
      offered_on DATE NOT NULL,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      -- The customer as TREFIN named it, when it named one
      party_name VARCHAR(200),
      total NUMERIC(12, 2) NOT NULL,
      -- Which TREFIN database
      source VARCHAR(40) NOT NULL
    )
  `.execute(db);
  await sql`CREATE INDEX trefin_offers_offered_on_idx ON trefin_offers (offered_on DESC, id DESC)`.execute(db);
  await sql`
    CREATE TABLE trefin_offer_lines (
      id SERIAL PRIMARY KEY,
      offer_id INTEGER NOT NULL REFERENCES trefin_offers(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name VARCHAR(200) NOT NULL,
      quantity NUMERIC(12, 3) NOT NULL,
      unit_price NUMERIC(12, 4) NOT NULL,
      total NUMERIC(12, 2) NOT NULL
    )
  `.execute(db);
  await sql`CREATE INDEX trefin_offer_lines_offer_idx ON trefin_offer_lines (offer_id)`.execute(db);
  await sql`
    CREATE TABLE trefin_activity (
      id SERIAL PRIMARY KEY,
      done_at TIMESTAMPTZ NOT NULL,
      -- TREFIN's user, by name only
      person VARCHAR(80),
      -- Like 4VD's own actions ('sale.created', 'auth.login', ...), so the same kind filters work
      action VARCHAR(40) NOT NULL,
      -- What it was about, as a word the dashboard translates: 'receipt', 'bill', 'product', ...
      what VARCHAR(20) NOT NULL,
      -- The document's number or the record's name
      subject VARCHAR(200)
    )
  `.execute(db);
  await sql`CREATE INDEX trefin_activity_done_at_idx ON trefin_activity (done_at DESC, id DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS trefin_activity`.execute(db);
  await sql`DROP TABLE IF EXISTS trefin_offer_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS trefin_offers`.execute(db);
}
