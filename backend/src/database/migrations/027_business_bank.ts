import { type Kysely, sql } from 'kysely';

/** The shop's bank account, printed on invoices so business customers know where to pay. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE businesses
      ADD COLUMN bank_name VARCHAR(100),
      ADD COLUMN iban VARCHAR(34)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE businesses DROP COLUMN IF EXISTS bank_name, DROP COLUMN IF EXISTS iban`.execute(db);
}
