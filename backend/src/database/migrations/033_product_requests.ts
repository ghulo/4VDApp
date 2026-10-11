import { type Kysely, sql } from 'kysely';

/**
 * A product someone at the counter wants added. It is not a product yet: it
 * can't be sold or counted until someone who runs the shop approves it, which
 * creates the product from it (with any corrections they made).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE product_requests (
      id SERIAL PRIMARY KEY,
      status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      name VARCHAR(255) NOT NULL,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
      vat_rate SMALLINT NOT NULL DEFAULT 18 CHECK (vat_rate IN (0, 8, 18)),
      barcode VARCHAR(64),
      origin_country CHAR(2) CHECK (origin_country ~ '^[A-Z]{2}$'),
      photo_media_id TEXT,
      -- How many are on the shelf now; becomes the starting stock.
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      note TEXT,
      requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      decided_at TIMESTAMPTZ,
      decision_note TEXT,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL
    )
  `.execute(db);
  await sql`CREATE INDEX idx_product_requests_pending ON product_requests (requested_at) WHERE status = 'pending'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS product_requests`.execute(db);
}
