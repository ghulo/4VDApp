import { type Kysely, sql } from 'kysely';

/**
 * A session remembers which business it works in. Someone in two businesses
 * (or 4VD's developer) switches with the business picker; without this a
 * refresh would always bring them back to their home business.
 *
 * `refresh_tokens.business_id`: null = the person's home business (every
 * session from before this). refresh_tokens stays a global table (read at
 * sign-in, before any business is known), so no row security here.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE refresh_tokens ADD COLUMN business_id INT REFERENCES businesses(id) ON DELETE SET NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE refresh_tokens DROP COLUMN business_id`.execute(db);
}
