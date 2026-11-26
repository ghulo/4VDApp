import { type Kysely, sql } from 'kysely';

/**
 * Quick keys at the Counter: the owner picks up to 24 products (bread, fruit,
 * anything without a barcode) that show as tiles on an empty basket. The place
 * is kept on the product itself, so the tiles come with the till's shelf and
 * work without internet too. One place per tile within a business.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Products are read by every till: wait a little for a lock, never block them long.
  await sql`SET LOCAL lock_timeout = '10s'`.execute(db);
  await sql`ALTER TABLE products ADD COLUMN quick_key SMALLINT CHECK (quick_key BETWEEN 1 AND 24)`.execute(db);
  await sql`CREATE UNIQUE INDEX products_quick_key ON products (business_id, quick_key) WHERE quick_key IS NOT NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS products_quick_key`.execute(db);
  await sql`ALTER TABLE products DROP COLUMN IF EXISTS quick_key`.execute(db);
}
