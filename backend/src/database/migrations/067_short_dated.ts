import { type Kysely, sql } from 'kysely';

/**
 * Short-dated stock. A product can be marked as having a best-before date, so
 * the date is asked for when it comes in. Each noted date is a batch: close to
 * it, the cashier can sell a stickered unit at a short-dated price, and each
 * such sale remembers its batch so the discount stops when the batch is gone.
 * How many days before counts as "short-dated" is a shop setting, with an
 * override per category and per product.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE products ADD COLUMN has_best_before BOOLEAN NOT NULL DEFAULT false`.execute(db);
  await sql`ALTER TABLE products ADD COLUMN short_dated_days SMALLINT CHECK (short_dated_days BETWEEN 1 AND 60)`.execute(db);
  await sql`ALTER TABLE categories ADD COLUMN short_dated_days SMALLINT CHECK (short_dated_days BETWEEN 1 AND 60)`.execute(db);
  await sql`ALTER TABLE sales ADD COLUMN expiry_date_id INT REFERENCES expiry_dates(id) ON DELETE SET NULL`.execute(db);
  await sql`ALTER TABLE sales ADD COLUMN short_dated_percent NUMERIC(5, 2)`.execute(db);
  await sql`CREATE INDEX sales_expiry_date_idx ON sales (expiry_date_id) WHERE expiry_date_id IS NOT NULL`.execute(db);
  await sql`ALTER TABLE expiry_dates ADD COLUMN write_off_id INT REFERENCES write_offs(id) ON DELETE SET NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE expiry_dates DROP COLUMN IF EXISTS write_off_id`.execute(db);
  await sql`ALTER TABLE sales DROP COLUMN IF EXISTS short_dated_percent`.execute(db);
  await sql`ALTER TABLE sales DROP COLUMN IF EXISTS expiry_date_id`.execute(db);
  await sql`ALTER TABLE categories DROP COLUMN IF EXISTS short_dated_days`.execute(db);
  await sql`ALTER TABLE products DROP COLUMN IF EXISTS short_dated_days`.execute(db);
  await sql`ALTER TABLE products DROP COLUMN IF EXISTS has_best_before`.execute(db);
}
