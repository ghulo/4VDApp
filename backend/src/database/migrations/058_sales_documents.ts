import { type Kysely, sql } from 'kysely';

/**
 * Step 8, sales documents: pay later, offers made in 4VD, deliveries.
 *
 * - `customers.pay_later`: the owner said this customer may take goods and pay
 *   later, up to `credit_limit` (none: no cap). Customers who already have
 *   something on their tab were let pay later before, so they start switched on.
 * - `rabat_approvals` becomes an owner's one-time yes to either a bigger rabat
 *   or a pay-later sale (`purpose`; `customer_id` and `amount` for pay later).
 * - `offers` / `offer_lines`: a price quote made in 4VD (TREFIN's stay in
 *   `trefin_offers`). `sale_document_id` is the invoice its yes became.
 * - `customer_deliveries`: a sale taken to the customer, with what to collect
 *   at the door and who took it.
 */
const KINDS_056 = `'line_removed', 'basket_cancelled', 'drawer_opened', 'print_failed', 'reprinted', 'x_report', 'z_report', 'rabat_allowed', 'person_switched'`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE customers ADD COLUMN pay_later BOOLEAN NOT NULL DEFAULT false`.execute(db);
  await sql`UPDATE customers c SET pay_later = true WHERE EXISTS (SELECT 1 FROM tab_entries e WHERE e.customer_id = c.id AND e.kind = 'charge')`.execute(db);

  await sql`
    ALTER TABLE rabat_approvals
      ADD COLUMN purpose VARCHAR(10) NOT NULL DEFAULT 'rabat' CHECK (purpose IN ('rabat', 'pay_later')),
      ADD COLUMN customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
      ADD COLUMN amount NUMERIC(12, 2),
      ALTER COLUMN percent DROP NOT NULL
  `.execute(db);
  await sql`ALTER TABLE pin_attempts DROP CONSTRAINT IF EXISTS pin_attempts_purpose_check`.execute(db);
  await sql`ALTER TABLE pin_attempts ADD CONSTRAINT pin_attempts_purpose_check CHECK (purpose IN ('switch', 'rabat', 'pay_later'))`.execute(db);
  await sql`ALTER TABLE counter_events DROP CONSTRAINT counter_events_kind_check`.execute(db);
  await sql`ALTER TABLE counter_events ADD CONSTRAINT counter_events_kind_check CHECK (kind IN (${sql.raw(KINDS_056)}, 'pay_later_allowed'))`.execute(db);

  await sql`
    CREATE TABLE offers (
      id SERIAL PRIMARY KEY,
      number VARCHAR(40) NOT NULL UNIQUE,
      customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
      party_name VARCHAR(200),
      party_phone VARCHAR(40),
      note TEXT,
      valid_until DATE NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'declined')),
      total NUMERIC(12, 2) NOT NULL,
      sale_document_id INT REFERENCES documents(id) ON DELETE SET NULL,
      decided_at TIMESTAMPTZ,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (customer_id IS NOT NULL OR party_name IS NOT NULL)
    )
  `.execute(db);
  await sql`CREATE INDEX offers_created_idx ON offers (created_at DESC, id DESC)`.execute(db);
  await sql`
    CREATE TABLE offer_lines (
      id SERIAL PRIMARY KEY,
      offer_id INT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id),
      product_name VARCHAR(200) NOT NULL,
      quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
      unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
      shelf_price NUMERIC(12, 2) NOT NULL,
      total NUMERIC(12, 2) NOT NULL
    )
  `.execute(db);
  await sql`CREATE INDEX offer_lines_offer_idx ON offer_lines (offer_id)`.execute(db);

  await sql`
    CREATE TABLE customer_deliveries (
      id SERIAL PRIMARY KEY,
      document_id INT NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
      customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
      name VARCHAR(200) NOT NULL,
      phone VARCHAR(40),
      address VARCHAR(400) NOT NULL,
      deliver_on DATE NOT NULL,
      time_from TIME,
      time_to TIME,
      note TEXT,
      total NUMERIC(12, 2) NOT NULL,
      to_collect NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (to_collect >= 0),
      status VARCHAR(12) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'on_the_way', 'delivered')),
      taken_by INT REFERENCES users(id) ON DELETE SET NULL,
      taken_at TIMESTAMPTZ,
      delivered_by INT REFERENCES users(id) ON DELETE SET NULL,
      delivered_at TIMESTAMPTZ,
      collected NUMERIC(12, 2),
      payment_entry_id INT REFERENCES tab_entries(id) ON DELETE SET NULL,
      last_failure TEXT,
      failures INT NOT NULL DEFAULT 0,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX customer_deliveries_open_idx ON customer_deliveries (deliver_on) WHERE status <> 'delivered'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS customer_deliveries`.execute(db);
  await sql`DROP TABLE IF EXISTS offer_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS offers`.execute(db);
  await sql`DELETE FROM counter_events WHERE kind = 'pay_later_allowed'`.execute(db);
  await sql`ALTER TABLE counter_events DROP CONSTRAINT counter_events_kind_check`.execute(db);
  await sql`ALTER TABLE counter_events ADD CONSTRAINT counter_events_kind_check CHECK (kind IN (${sql.raw(KINDS_056)}))`.execute(db);
  await sql`DELETE FROM pin_attempts WHERE purpose = 'pay_later'`.execute(db);
  await sql`ALTER TABLE pin_attempts DROP CONSTRAINT IF EXISTS pin_attempts_purpose_check`.execute(db);
  await sql`DELETE FROM rabat_approvals WHERE purpose = 'pay_later'`.execute(db);
  await sql`ALTER TABLE rabat_approvals DROP COLUMN purpose, DROP COLUMN customer_id, DROP COLUMN amount, ALTER COLUMN percent SET NOT NULL`.execute(db);
  await sql`ALTER TABLE customers DROP COLUMN pay_later`.execute(db);
}
