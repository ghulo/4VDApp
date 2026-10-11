import { type Kysely, sql } from 'kysely';

/**
 * What confirming a scan changed (products added, costs and barcodes before,
 * codes before, the order, the stock that came in), so the developer can
 * reopen a confirmed scan and have every change put back exactly.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE bill_scans ADD COLUMN confirmation JSONB`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE bill_scans DROP COLUMN IF EXISTS confirmation`.execute(db);
}
