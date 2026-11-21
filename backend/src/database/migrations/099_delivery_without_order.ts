import { type Kysely, sql } from 'kysely';

/**
 * Staff tick off a delivery that came without an order: an order is made from
 * what they counted and received at once. Its arrival_key is the key the
 * phone gave that press, kept once per business, so a second copy (an answer
 * lost on the way) doesn't put the goods in twice. A scanned bill for it
 * points at that order (arrived_order_id), so checking the bill sets its costs
 * and saves the bill without adding the goods again.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Both tables are written by the counter and the dashboard: wait a little for a lock, never block them long.
  await sql`SET LOCAL lock_timeout = '10s'`.execute(db);
  await sql`ALTER TABLE purchase_orders ADD COLUMN arrival_key UUID`.execute(db);
  await sql`CREATE UNIQUE INDEX purchase_orders_arrival_key ON purchase_orders (business_id, arrival_key) WHERE arrival_key IS NOT NULL`.execute(db);
  await sql`ALTER TABLE bill_scans ADD COLUMN arrived_order_id INT REFERENCES purchase_orders(id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE bill_scans DROP COLUMN IF EXISTS arrived_order_id`.execute(db);
  await sql`DROP INDEX IF EXISTS purchase_orders_arrival_key`.execute(db);
  await sql`ALTER TABLE purchase_orders DROP COLUMN IF EXISTS arrival_key`.execute(db);
}
