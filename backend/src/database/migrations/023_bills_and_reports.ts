import { type Kysely, sql } from 'kysely';

/**
 * Supplier bills: the invoices suppliers send, and what has been paid on each.
 * A bill can be paid in parts; a payment says how (cash from the shop drawer,
 * other cash, or bank). Drawer payments lower what the shop's cash check
 * expects. Mistakes are voided (kept, crossed out), never deleted.
 *
 * Report subscriptions: each owner, admin and developer chooses their own
 * daily and weekly report (which sections, when, and whether it also comes by
 * email). The last day each one went out is kept so restarts never resend.
 * The old Monday email setting carries over as the email choice.
 *
 * Notifications get a link: the page a tap opens (a report goes to that report).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE supplier_bills (
      id SERIAL PRIMARY KEY,
      supplier_id INT NOT NULL REFERENCES suppliers(id),
      order_id INT UNIQUE REFERENCES purchase_orders(id),
      number VARCHAR(60),
      issued_on DATE NOT NULL,
      due_on DATE,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      note TEXT,
      photo_media_id UUID REFERENCES media(id) ON DELETE SET NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_at TIMESTAMPTZ,
      voided_by INT REFERENCES users(id) ON DELETE SET NULL,
      void_note TEXT,
      CHECK (due_on IS NULL OR due_on >= issued_on)
    )
  `.execute(db);
  await sql`CREATE INDEX supplier_bills_supplier_idx ON supplier_bills (supplier_id) WHERE voided_at IS NULL`.execute(db);

  await sql`
    CREATE TABLE supplier_payments (
      id SERIAL PRIMARY KEY,
      bill_id INT NOT NULL REFERENCES supplier_bills(id),
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      paid_on DATE NOT NULL,
      method VARCHAR(12) NOT NULL CHECK (method IN ('drawer', 'cash', 'bank')),
      note TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_at TIMESTAMPTZ,
      voided_by INT REFERENCES users(id) ON DELETE SET NULL
    )
  `.execute(db);
  await sql`CREATE INDEX supplier_payments_bill_idx ON supplier_payments (bill_id)`.execute(db);
  await sql`CREATE INDEX supplier_payments_day_idx ON supplier_payments (paid_on) WHERE voided_at IS NULL`.execute(db);

  await sql`
    CREATE TABLE report_subscriptions (
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      daily_enabled BOOLEAN NOT NULL DEFAULT true,
      daily_hour SMALLINT NOT NULL DEFAULT 21 CHECK (daily_hour BETWEEN 0 AND 23),
      weekly_enabled BOOLEAN NOT NULL DEFAULT true,
      weekly_day SMALLINT NOT NULL DEFAULT 1 CHECK (weekly_day BETWEEN 1 AND 7),
      weekly_hour SMALLINT NOT NULL DEFAULT 8 CHECK (weekly_hour BETWEEN 0 AND 23),
      sections TEXT[],
      email BOOLEAN NOT NULL DEFAULT false,
      last_daily DATE,
      last_weekly DATE
    )
  `.execute(db);
  await sql`ALTER TABLE notifications ADD COLUMN link VARCHAR(300)`.execute(db);
  await sql`
    INSERT INTO report_subscriptions (user_id, email, daily_hour)
    SELECT u.id, u.email_weekly_report,
           coalesce((SELECT (value #>> '{}')::smallint FROM settings WHERE key = 'daily_summary_hour'), 21)
    FROM users u WHERE u.deleted_at IS NULL AND u.role IN ('developer', 'admin', 'owner')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE notifications DROP COLUMN IF EXISTS link`.execute(db);
  await sql`DROP TABLE IF EXISTS report_subscriptions`.execute(db);
  await sql`DROP TABLE IF EXISTS supplier_payments`.execute(db);
  await sql`DROP TABLE IF EXISTS supplier_bills`.execute(db);
}
