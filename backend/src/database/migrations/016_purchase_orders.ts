import { type Kysely, sql } from 'kysely';

/**
 * Suppliers and the orders sent to them. An order stays open until its
 * delivery is ticked off; receiving it puts the stock in. Each line keeps
 * what was ordered and what actually came.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE suppliers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(40),
      email VARCHAR(255),
      note TEXT,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TABLE purchase_orders (
      id SERIAL PRIMARY KEY,
      supplier_id INT NOT NULL REFERENCES suppliers(id),
      status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'received', 'cancelled')),
      note TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_by INT REFERENCES users(id) ON DELETE SET NULL,
      closed_at TIMESTAMPTZ
    )
  `.execute(db);
  await sql`
    CREATE TABLE purchase_order_lines (
      id SERIAL PRIMARY KEY,
      order_id INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id),
      quantity INT NOT NULL CHECK (quantity > 0),
      unit_cost NUMERIC(12, 2) CHECK (unit_cost >= 0),
      received_quantity INT CHECK (received_quantity >= 0),
      UNIQUE (order_id, product_id)
    )
  `.execute(db);
  await sql`CREATE INDEX purchase_orders_status_idx ON purchase_orders (status, created_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS purchase_order_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS purchase_orders`.execute(db);
  await sql`DROP TABLE IF EXISTS suppliers`.execute(db);
}
