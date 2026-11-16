import { type Kysely, sql } from 'kysely';

/**
 * Step 15, follow-up: the shop may change a portal order (quantities, lines)
 * with a reason. The order then waits for the customer ("changed") until they
 * agree or cancel. `previous` keeps the order as the customer last agreed it,
 * so they can see what changed line by line.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE portal_orders DROP CONSTRAINT IF EXISTS portal_orders_status_check`.execute(db);
  await sql`ALTER TABLE portal_orders ADD CONSTRAINT portal_orders_status_check CHECK (status IN ('sent', 'seen', 'changed', 'accepted', 'declined', 'cancelled'))`.execute(db);
  await sql`
    ALTER TABLE portal_orders
      ADD COLUMN change_reason TEXT,
      ADD COLUMN changed_at TIMESTAMPTZ,
      ADD COLUMN changed_by INT REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN change_seen_at TIMESTAMPTZ,
      ADD COLUMN change_agreed_at TIMESTAMPTZ,
      ADD COLUMN previous JSONB
  `.execute(db);
  await sql`DROP INDEX IF EXISTS portal_orders_open_idx`.execute(db);
  await sql`CREATE INDEX portal_orders_open_idx ON portal_orders (created_at) WHERE status IN ('sent', 'seen', 'changed')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE portal_orders SET status = 'seen' WHERE status = 'changed'`.execute(db);
  await sql`ALTER TABLE portal_orders DROP CONSTRAINT IF EXISTS portal_orders_status_check`.execute(db);
  await sql`ALTER TABLE portal_orders ADD CONSTRAINT portal_orders_status_check CHECK (status IN ('sent', 'seen', 'accepted', 'declined', 'cancelled'))`.execute(db);
  await sql`ALTER TABLE portal_orders DROP COLUMN change_reason, DROP COLUMN changed_at, DROP COLUMN changed_by, DROP COLUMN change_seen_at, DROP COLUMN change_agreed_at, DROP COLUMN previous`.execute(db);
  await sql`DROP INDEX IF EXISTS portal_orders_open_idx`.execute(db);
  await sql`CREATE INDEX portal_orders_open_idx ON portal_orders (created_at) WHERE status IN ('sent', 'seen')`.execute(db);
}
