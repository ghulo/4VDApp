import { type Kysely, sql } from 'kysely';

/**
 * The yearly income declaration to ATK (step 17).
 *
 * - `businesses.legal_form`: a company (sh.p.k., sh.a.) files the CD and pays
 *   10% profit tax; an individual business (B.I.) files the PD and pays
 *   personal income tax on the yearly bands.
 * - `tax_declarations`: one row per year with what the accountant typed
 *   (adjustments, losses from TREFIN years, whether the carwash counts) and,
 *   once marked as filed, the figures as filed.
 * - `tax_instalments.quarter` 0: the rest of the year's tax, paid with the
 *   declaration by 31 March (quarters 1 to 4 are the TM).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE businesses
      ADD COLUMN legal_form VARCHAR(10) NOT NULL DEFAULT 'company' CHECK (legal_form IN ('company', 'individual'))
  `.execute(db);
  await sql`
    CREATE TABLE tax_declarations (
      year INT PRIMARY KEY,
      inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
      filed_on DATE,
      filed_by INT REFERENCES users(id) ON DELETE SET NULL,
      filed_at TIMESTAMPTZ,
      filed JSONB,
      updated_by INT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`ALTER TABLE tax_instalments DROP CONSTRAINT IF EXISTS tax_instalments_quarter_check`.execute(db);
  await sql`ALTER TABLE tax_instalments ADD CONSTRAINT tax_instalments_quarter_check CHECK (quarter BETWEEN 0 AND 4)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM tax_instalments WHERE quarter = 0`.execute(db);
  await sql`ALTER TABLE tax_instalments DROP CONSTRAINT IF EXISTS tax_instalments_quarter_check`.execute(db);
  await sql`ALTER TABLE tax_instalments ADD CONSTRAINT tax_instalments_quarter_check CHECK (quarter BETWEEN 1 AND 4)`.execute(db);
  await sql`DROP TABLE tax_declarations`.execute(db);
  await sql`ALTER TABLE businesses DROP COLUMN legal_form`.execute(db);
}
