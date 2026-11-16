import { type Kysely, sql } from 'kysely';

/**
 * Step 15, the portal for business customers (4vd.app/portal).
 *
 * - `customers.portal_*`: what the shop lets each customer do there: the portal
 *   on or off, ordering on or off, a minimum order, and which categories they
 *   see (null: all of them).
 * - `portal_users`: the people at a customer who may sign in. Kept apart from
 *   `users` on purpose: they never get a role, a power or a dashboard token.
 * - `portal_links`: one-time links (an invite, or a sign-in link by email).
 *   Only the SHA-256 of the token is kept.
 * - `portal_sessions`: a signed-in phone, held in an httpOnly cookie; only the
 *   token's hash is kept, and it can be revoked at once.
 * - `portal_orders` / `portal_order_lines`: what a customer sent. It touches no
 *   stock, books or numbers until the shop accepts it as an offer.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE customers
      ADD COLUMN portal_enabled BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN portal_can_order BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN portal_min_order NUMERIC(12, 2) CHECK (portal_min_order > 0),
      ADD COLUMN portal_categories INT[]
  `.execute(db);

  await sql`
    CREATE TABLE portal_users (
      id SERIAL PRIMARY KEY,
      customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(254),
      phone VARCHAR(40),
      language VARCHAR(2) NOT NULL DEFAULT 'sq' CHECK (language IN ('sq', 'en')),
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ,
      removed_at TIMESTAMPTZ
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX portal_users_email_idx ON portal_users (lower(email)) WHERE removed_at IS NULL AND email IS NOT NULL`.execute(db);
  await sql`CREATE INDEX portal_users_customer_idx ON portal_users (customer_id)`.execute(db);

  await sql`
    CREATE TABLE portal_links (
      id SERIAL PRIMARY KEY,
      portal_user_id INT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
      purpose VARCHAR(10) NOT NULL CHECK (purpose IN ('invite', 'sign_in')),
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE portal_sessions (
      id SERIAL PRIMARY KEY,
      portal_user_id INT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX portal_sessions_user_idx ON portal_sessions (portal_user_id)`.execute(db);

  await sql`
    CREATE TABLE portal_orders (
      id SERIAL PRIMARY KEY,
      customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      portal_user_id INT REFERENCES portal_users(id) ON DELETE SET NULL,
      note TEXT,
      status VARCHAR(10) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'seen', 'accepted', 'declined', 'cancelled')),
      net NUMERIC(12, 2) NOT NULL,
      vat NUMERIC(12, 2) NOT NULL,
      total NUMERIC(12, 2) NOT NULL,
      seen_at TIMESTAMPTZ,
      seen_by INT REFERENCES users(id) ON DELETE SET NULL,
      decided_at TIMESTAMPTZ,
      decided_by INT REFERENCES users(id) ON DELETE SET NULL,
      decline_reason TEXT,
      offer_id INT REFERENCES offers(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX portal_orders_customer_idx ON portal_orders (customer_id, created_at DESC)`.execute(db);
  await sql`CREATE INDEX portal_orders_open_idx ON portal_orders (created_at) WHERE status IN ('sent', 'seen')`.execute(db);
  await sql`
    CREATE TABLE portal_order_lines (
      id SERIAL PRIMARY KEY,
      order_id INT NOT NULL REFERENCES portal_orders(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id),
      product_name VARCHAR(200) NOT NULL,
      unit VARCHAR(10) NOT NULL,
      quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
      unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
      vat_rate NUMERIC(5, 2) NOT NULL,
      total NUMERIC(12, 2) NOT NULL,
      in_stock BOOLEAN NOT NULL
    )
  `.execute(db);
  await sql`CREATE INDEX portal_order_lines_order_idx ON portal_order_lines (order_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS portal_order_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS portal_orders`.execute(db);
  await sql`DROP TABLE IF EXISTS portal_sessions`.execute(db);
  await sql`DROP TABLE IF EXISTS portal_links`.execute(db);
  await sql`DROP TABLE IF EXISTS portal_users`.execute(db);
  await sql`ALTER TABLE customers DROP COLUMN portal_enabled, DROP COLUMN portal_can_order, DROP COLUMN portal_min_order, DROP COLUMN portal_categories`.execute(db);
}
