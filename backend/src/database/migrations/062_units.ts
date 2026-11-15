import { type Kysely, sql } from 'kysely';

/**
 * Step 9, units: besides the piece and the kilo, a product can be sold by the
 * litre ('l'), the metre ('m') or the square metre ('m2'). Measured units move
 * in parts, like kilos (the app checks); only kilo products have a scale number.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_unit_check`.execute(db);
  await sql`ALTER TABLE products ADD CONSTRAINT products_unit_check CHECK (unit IN ('piece', 'kg', 'l', 'm', 'm2'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE products SET unit = 'kg' WHERE unit IN ('l', 'm', 'm2')`.execute(db);
  await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_unit_check`.execute(db);
  await sql`ALTER TABLE products ADD CONSTRAINT products_unit_check CHECK (unit IN ('piece', 'kg'))`.execute(db);
}
