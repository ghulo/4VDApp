import { type Kysely, sql } from 'kysely';

/**
 * The counter on the shop PC.
 *
 * - An invoice can be paid by card (the bank's card terminal): its money goes
 *   to the bank, not the drawer.
 * - `counter_events`: what happened at the counter that isn't a sale, by
 *   person: a line taken off a basket, a basket cancelled, the drawer opened
 *   without a sale, a fiscal receipt that didn't print, a receipt printed
 *   again, the printer's X and Z reports. The counter report reads them.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_payment_method_check`.execute(db);
  await sql`ALTER TABLE documents ADD CONSTRAINT documents_payment_method_check CHECK (payment_method IN ('till', 'account', 'card'))`.execute(db);

  await sql`
    CREATE TABLE counter_events (
      id SERIAL PRIMARY KEY,
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('line_removed', 'basket_cancelled', 'drawer_opened', 'print_failed', 'reprinted', 'x_report', 'z_report')),
      user_id INT REFERENCES users(id),
      product_id INT REFERENCES products(id),
      quantity INT,
      -- The money the line or basket was worth.
      amount NUMERIC(12, 2),
      reason VARCHAR(200),
      document_id INT REFERENCES documents(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX counter_events_created_at ON counter_events (created_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS counter_events`.execute(db);
  await sql`UPDATE documents SET payment_method = 'till' WHERE payment_method = 'card'`.execute(db);
  await sql`ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_payment_method_check`.execute(db);
  await sql`ALTER TABLE documents ADD CONSTRAINT documents_payment_method_check CHECK (payment_method IN ('till', 'account'))`.execute(db);
}
