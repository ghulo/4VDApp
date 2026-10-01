import { type Kysely, sql } from 'kysely';

/**
 * - sales.unit_cost: the product's cost when it was sold, so profit doesn't
 *   change when a cost price is edited later. Existing sales are filled from
 *   today's cost, which is the best information available for them.
 * - activity_log: who changed what, for the admin's Activity page.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sales ADD COLUMN unit_cost DECIMAL(10, 2) CHECK (unit_cost >= 0)`.execute(db);
  await sql`UPDATE sales s SET unit_cost = p.cost_price FROM products p WHERE p.id = s.product_id`.execute(db);

  await sql`CREATE TABLE activity_log (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(30),
    entity_id INT,
    summary TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`.execute(db);
  await sql`CREATE INDEX idx_activity_log_created ON activity_log (created_at DESC)`.execute(db);
  await sql`CREATE INDEX idx_activity_log_user ON activity_log (user_id)`.execute(db);
  await sql`CREATE INDEX idx_activity_log_entity ON activity_log (entity_type, entity_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS activity_log`.execute(db);
  await sql`ALTER TABLE sales DROP COLUMN IF EXISTS unit_cost`.execute(db);
}
