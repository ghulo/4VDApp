import { type Kysely, sql } from 'kysely';

/**
 * The end-of-day checklist asks whether today's expenses are in. Most days have
 * some; on a day with none, a manager says so here, so the list can still close.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE no_expense_days (
      day DATE PRIMARY KEY,
      marked_by INT REFERENCES users(id) ON DELETE SET NULL,
      marked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS no_expense_days`.execute(db);
}
