import { type Kysely, sql } from 'kysely';

/**
 * What the business spends: rent, power, wages and so on, for the shop, the
 * carwash or both. Expenses that come back every month (rent, wages) are kept
 * as a repeating rule that adds the month's expense by itself; deleting one
 * month's copy doesn't bring it back, because the rule remembers how far it
 * has filled in.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE recurring_expenses (
      id SERIAL PRIMARY KEY,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      category VARCHAR(32) NOT NULL,
      place VARCHAR(16) NOT NULL CHECK (place IN ('shop', 'carwash', 'both')),
      note TEXT,
      day_of_month INT NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
      last_filled_on DATE NOT NULL,
      stopped_at TIMESTAMPTZ,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TABLE expenses (
      id SERIAL PRIMARY KEY,
      day DATE NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      category VARCHAR(32) NOT NULL,
      place VARCHAR(16) NOT NULL CHECK (place IN ('shop', 'carwash', 'both')),
      note TEXT,
      recurring_id INT REFERENCES recurring_expenses(id) ON DELETE SET NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (recurring_id, day)
    )
  `.execute(db);
  await sql`CREATE INDEX expenses_day_idx ON expenses (day)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS expenses`.execute(db);
  await sql`DROP TABLE IF EXISTS recurring_expenses`.execute(db);
}
