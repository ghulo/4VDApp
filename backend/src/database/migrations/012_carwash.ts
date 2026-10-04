import { type Kysely, sql } from 'kysely';

/**
 * The carwash's takings, one row per day: what the wash made and what the
 * change machine (notes into coins) made. No products, just the two amounts.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE carwash_days (
      day DATE PRIMARY KEY,
      carwash_amount NUMERIC(12, 2) NOT NULL CHECK (carwash_amount >= 0),
      change_amount NUMERIC(12, 2) NOT NULL CHECK (change_amount >= 0),
      recorded_by INT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS carwash_days`.execute(db);
}
