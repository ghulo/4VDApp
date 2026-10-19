import { type Kysely, sql } from 'kysely';

/**
 * The opening cash: what was counted into a drawer at the start of the day.
 * The evening count then starts from it instead of the usual float in
 * Settings, and overseers can see what the drawer should hold during the day.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE cash_openings (
      id SERIAL PRIMARY KEY,
      place VARCHAR(16) NOT NULL CHECK (place IN ('shop', 'carwash')),
      carwash_id INT REFERENCES carwashes(id) ON DELETE CASCADE,
      day DATE NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
      opened_by INT REFERENCES users(id) ON DELETE SET NULL,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT cash_openings_drawer_day_key UNIQUE NULLS NOT DISTINCT (place, carwash_id, day)
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS cash_openings`.execute(db);
}
