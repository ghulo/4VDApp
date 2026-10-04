import { type Kysely, sql } from 'kysely';

/**
 * Expiry dates: "this many units of this product expire on this day". Noted
 * by hand or when a delivery comes in, and marked done once they're sold or
 * written off. They don't move stock themselves; write-offs still go through
 * their own (approved) flow.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE expiry_dates (
      id SERIAL PRIMARY KEY,
      product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INT NOT NULL CHECK (quantity > 0),
      expires_on DATE NOT NULL,
      note TEXT,
      order_line_id INT REFERENCES purchase_order_lines(id) ON DELETE SET NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      cleared_by INT REFERENCES users(id) ON DELETE SET NULL,
      cleared_at TIMESTAMPTZ
    )
  `.execute(db);
  await sql`CREATE INDEX expiry_dates_open_idx ON expiry_dates (expires_on) WHERE cleared_at IS NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS expiry_dates`.execute(db);
}
