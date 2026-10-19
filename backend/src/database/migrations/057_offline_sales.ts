import { type Kysely, sql } from 'kysely';

/**
 * Sales the Counter made while the internet was down, sent later.
 *
 * - `documents.client_key`: the key the Counter gave the sale when Pay was
 *   pressed. A sale sent twice (the answer got lost) is recorded once.
 * - `offline_shortfalls`: an offline sale that sold more than 4VD thought
 *   was on the shelf. Stock went to 0 and a To do asks for a count, until
 *   the product is counted again.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE documents ADD COLUMN client_key UUID`.execute(db);
  await sql`CREATE UNIQUE INDEX documents_client_key_key ON documents (client_key) WHERE client_key IS NOT NULL`.execute(db);
  await sql`
    CREATE TABLE offline_shortfalls (
      id SERIAL PRIMARY KEY,
      product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      sale_id INT REFERENCES sales(id) ON DELETE SET NULL,
      short_by DOUBLE PRECISION NOT NULL CHECK (short_by > 0),
      sold_by INT REFERENCES users(id) ON DELETE SET NULL,
      sold_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX offline_shortfalls_product_idx ON offline_shortfalls (product_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS offline_shortfalls`.execute(db);
  await sql`DROP INDEX IF EXISTS documents_client_key_key`.execute(db);
  await sql`ALTER TABLE documents DROP COLUMN IF EXISTS client_key`.execute(db);
}
