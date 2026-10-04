import { type Kysely, sql } from 'kysely';

/**
 * Regulars who take things now and pay later. A tab is a list of charges
 * (usually a sale put on the tab) and payments; what's owed is worked out from
 * them. A charge whose sale was undone no longer counts, so undoing and
 * restoring a sale fixes the tab by itself.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE customers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(40),
      note TEXT,
      archived_at TIMESTAMPTZ,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TABLE tab_entries (
      id SERIAL PRIMARY KEY,
      customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('charge', 'payment')),
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      note TEXT,
      sale_id INT REFERENCES sales(id) ON DELETE SET NULL,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by INT REFERENCES users(id) ON DELETE SET NULL
    )
  `.execute(db);
  await sql`CREATE INDEX tab_entries_customer_idx ON tab_entries (customer_id, occurred_at)`.execute(db);
  await sql`CREATE INDEX tab_entries_occurred_idx ON tab_entries (occurred_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS tab_entries`.execute(db);
  await sql`DROP TABLE IF EXISTS customers`.execute(db);
}
