import { type Kysely, sql } from 'kysely';

/**
 * Step 9, wholesale prices at the till and on invoices.
 *
 * - `customers.pays_wholesale`: this customer pays the wholesale price
 *   (`products.wholesale_price`) instead of the shelf price. New business
 *   customers start with it on; the owner can change it on any customer.
 * - `sales.wholesale`: the line was sold at the wholesale price (from the
 *   customer, or switched on for that one sale).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE customers ADD COLUMN pays_wholesale BOOLEAN NOT NULL DEFAULT false`.execute(db);
  await sql`ALTER TABLE sales ADD COLUMN wholesale BOOLEAN NOT NULL DEFAULT false`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sales DROP COLUMN IF EXISTS wholesale`.execute(db);
  await sql`ALTER TABLE customers DROP COLUMN IF EXISTS pays_wholesale`.execute(db);
}
