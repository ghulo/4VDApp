import { type Kysely, sql } from 'kysely';

/**
 * Promotions, a minimum margin, and sales targets and commission per person
 * (see docs/superpowers/specs/2026-10-02-price-control-and-team-design.md).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const statements = [
    sql`CREATE TABLE promotions (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      percent_off DECIMAL(5, 2) NOT NULL CHECK (percent_off > 0 AND percent_off <= 90),
      product_id INT REFERENCES products(id),
      category_id INT REFERENCES categories(id),
      starts_at TIMESTAMPTZ NOT NULL,
      -- End-exclusive, like every date range in the app.
      ends_at TIMESTAMPTZ NOT NULL,
      created_by INT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_early_at TIMESTAMPTZ,
      CHECK ((product_id IS NULL) <> (category_id IS NULL)),
      CHECK (ends_at > starts_at)
    )`,
    sql`CREATE INDEX idx_promotions_dates ON promotions(starts_at, ends_at)`,
    sql`ALTER TABLE sales ADD COLUMN promotion_id INT REFERENCES promotions(id)`,
    sql`ALTER TABLE users ADD COLUMN monthly_target DECIMAL(12, 2) CHECK (monthly_target >= 0)`,
    sql`ALTER TABLE users ADD COLUMN commission_percent DECIMAL(5, 2) CHECK (commission_percent >= 0 AND commission_percent <= 100)`,
    sql`INSERT INTO settings (key, value) VALUES ('minimum_margin_percent', '0') ON CONFLICT (key) DO NOTHING`,
  ];

  for (const statement of statements) {
    await statement.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM settings WHERE key = 'minimum_margin_percent'`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS commission_percent`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS monthly_target`.execute(db);
  await sql`ALTER TABLE sales DROP COLUMN IF EXISTS promotion_id`.execute(db);
  await sql`DROP TABLE IF EXISTS promotions`.execute(db);
}
