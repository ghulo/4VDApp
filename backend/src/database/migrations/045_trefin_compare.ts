import { type Kysely, sql } from 'kysely';

/**
 * One VAT month run next to TREFIN: TREFIN's documents for the month, as the
 * VAT return sees them (loaded from a fresh TREFIN export with
 * `npm run compare:trefin`), and the differences a person has explained.
 *
 * - `items`: TREFIN's till days, invoices and bills with the boxes they fill.
 * - `explained`: difference key → who explained it, when and why.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE trefin_months (
      month DATE PRIMARY KEY,
      items JSONB NOT NULL,
      source VARCHAR(300),
      loaded_by INT REFERENCES users(id) ON DELETE SET NULL,
      loaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      explained JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS trefin_months`.execute(db);
}
