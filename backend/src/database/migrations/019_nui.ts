import { type Kysely, sql } from 'kysely';

/**
 * NUI (Numri Unik Identifikues), the 9-digit number Kosovo's business registry
 * gives every company. The shop keeps its own; a tab can belong to a business,
 * which then needs one; suppliers have one. Nullable so rows from before this
 * stay valid; the forms ask for it from now on.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE businesses ADD COLUMN nui VARCHAR(9)`.execute(db);
  await sql`ALTER TABLE suppliers ADD COLUMN nui VARCHAR(9)`.execute(db);
  await sql`ALTER TABLE customers ADD COLUMN kind VARCHAR(10) NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'business'))`.execute(db);
  await sql`ALTER TABLE customers ADD COLUMN nui VARCHAR(9)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE customers DROP COLUMN IF EXISTS nui`.execute(db);
  await sql`ALTER TABLE customers DROP COLUMN IF EXISTS kind`.execute(db);
  await sql`ALTER TABLE suppliers DROP COLUMN IF EXISTS nui`.execute(db);
  await sql`ALTER TABLE businesses DROP COLUMN IF EXISTS nui`.execute(db);
}
