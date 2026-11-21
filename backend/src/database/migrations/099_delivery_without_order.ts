import { type Kysely, sql } from 'kysely';

/**
 * Staff tick off a delivery that came without an order: an order is made from
 * what they counted and received at once. Its arrival_key is the key the
 * phone gave that press, kept once per business, so a second copy (an answer
 * lost on the way) doesn't put the goods in twice. A scanned bill for it
 * points at that order (arrived_order_id), so checking the bill sets its costs
 * and saves the bill without adding the goods again. received_key and
 * received_hash note the press that ticked an order off and what it sent, so
 * only that same press sent again is told "done".
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Both tables are written by the counter and the dashboard: wait a little for a lock, never block them long.
  await sql`SET LOCAL lock_timeout = '10s'`.execute(db);
  await sql`ALTER TABLE purchase_orders ADD COLUMN arrival_key UUID`.execute(db);
  await sql`ALTER TABLE purchase_orders ADD COLUMN received_key UUID`.execute(db);
  await sql`ALTER TABLE purchase_orders ADD COLUMN received_hash TEXT`.execute(db);
  await sql`CREATE UNIQUE INDEX purchase_orders_arrival_key ON purchase_orders (business_id, arrival_key) WHERE arrival_key IS NOT NULL`.execute(db);
  await sql`ALTER TABLE bill_scans ADD COLUMN arrived_order_id INT REFERENCES purchase_orders(id)`.execute(db);
}

/**
 * Safe as written only before anyone has used the feature. Once deliveries
 * came in this way, rolling back loses their replay keys and unlinks their
 * waiting bill photos, and the older code would then receive such a photo's
 * goods a second time on confirm. So before running it on live data: confirm
 * or discard every waiting scan with arrived_order_id set, and expect a
 * resend of an old arrival key to put its goods in again.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE bill_scans DROP COLUMN IF EXISTS arrived_order_id`.execute(db);
  await sql`DROP INDEX IF EXISTS purchase_orders_arrival_key`.execute(db);
  await sql`ALTER TABLE purchase_orders DROP COLUMN IF EXISTS received_hash`.execute(db);
  await sql`ALTER TABLE purchase_orders DROP COLUMN IF EXISTS received_key`.execute(db);
  await sql`ALTER TABLE purchase_orders DROP COLUMN IF EXISTS arrival_key`.execute(db);
}
