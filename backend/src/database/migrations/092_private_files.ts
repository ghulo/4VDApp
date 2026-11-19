import { type Kysely, sql } from 'kysely';

/**
 * Bill files (scans, mailed bills, attachments, a bill's photo) were saved
 * without their business, so /api/media couldn't tell whose they are and
 * showed them to anyone with the link. New ones are saved with it; this fills
 * it in for the old ones from the rows that point at them. Data only, on the
 * media table (no business rows change).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE media m SET business_id = a.business_id
    FROM attachments a WHERE a.media_id = m.id AND m.business_id IS NULL
  `.execute(db);
  await sql`
    UPDATE media m SET business_id = b.business_id
    FROM supplier_bills b WHERE b.photo_media_id = m.id AND m.business_id IS NULL
  `.execute(db);
  await sql`
    UPDATE media m SET business_id = e.business_id
    FROM bill_emails e WHERE e.media_id = m.id::text AND m.business_id IS NULL
  `.execute(db);
  await sql`
    UPDATE media m SET business_id = s.business_id
    FROM bill_scans s WHERE m.id::text = ANY(s.media_ids) AND m.business_id IS NULL
  `.execute(db);
}

/** Knowing a file's business does no harm, and which ones were empty before isn't kept: nothing to undo. */
export async function down(_db: Kysely<unknown>): Promise<void> {}
