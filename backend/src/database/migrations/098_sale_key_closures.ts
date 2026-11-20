import { type Kysely, sql } from 'kysely';

/**
 * A till sale's key (documents.client_key) that will never be recorded: the
 * server refused the sale (a clear "no", like no stock), or an owner stopped
 * a sale whose answer never came. Written under the same lock a sale with
 * that key takes, and only when no sale has it, so a copy of the sale still
 * on its way is refused too: the till may free the basket and sell it again
 * under a new key without it ever going in twice.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE sale_key_closures (
      business_id INT NOT NULL DEFAULT current_business_id() REFERENCES businesses(id),
      client_key UUID NOT NULL,
      reason VARCHAR(12) NOT NULL CHECK (reason IN ('refused', 'stopped')),
      message TEXT,
      closed_by INT REFERENCES users(id) ON DELETE SET NULL,
      closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (business_id, client_key)
    )
  `.execute(db);
  await sql`SELECT protect_business_table('sale_key_closures')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS sale_key_closures`.execute(db);
}
