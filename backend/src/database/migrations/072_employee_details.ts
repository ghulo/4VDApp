import { type Kysely, sql } from 'kysely';

/**
 * More about each person on the payroll: how to reach them, where they live,
 * their birthday (contracts and ATK paperwork) and which bank their account
 * is at. All optional; phone and email are filled from their 4VD account when
 * one is linked, but kept here so they stay right after the account changes.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE employees
      ADD COLUMN phone TEXT,
      ADD COLUMN email TEXT,
      ADD COLUMN address TEXT,
      ADD COLUMN birth_date DATE,
      ADD COLUMN bank_name TEXT
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE employees
      DROP COLUMN phone,
      DROP COLUMN email,
      DROP COLUMN address,
      DROP COLUMN birth_date,
      DROP COLUMN bank_name
  `.execute(db);
}
