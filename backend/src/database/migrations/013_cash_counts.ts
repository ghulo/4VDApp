import { type Kysely, sql } from 'kysely';

/**
 * The end-of-day cash check: what was counted in the drawer, per place (the
 * shop or the carwash) and day. What the app expected is worked out when it is
 * read, from that day's sales or carwash takings, so later refunds and fixes
 * show up in the difference.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE cash_counts (
      id SERIAL PRIMARY KEY,
      place VARCHAR(16) NOT NULL CHECK (place IN ('shop', 'carwash')),
      day DATE NOT NULL,
      float_amount NUMERIC(12, 2) NOT NULL CHECK (float_amount >= 0),
      counted_amount NUMERIC(12, 2) NOT NULL CHECK (counted_amount >= 0),
      note TEXT,
      counted_by INT REFERENCES users(id) ON DELETE SET NULL,
      counted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (place, day)
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS cash_counts`.execute(db);
}
