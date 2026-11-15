import { type Kysely, sql } from 'kysely';

/**
 * Step 11, settings and safety.
 *
 * - `businesses.stamp_media_id`, `signature_media_id`: pictures of the shop's
 *   stamp and the seller's signature, printed on invoices.
 * - Offers take their next number from `document_numbers` (kind 'offer') like
 *   invoices, so a changed number format can't restart or mis-sort them. The
 *   counter starts from this year's highest offer.
 * - `attachments`: files (PDFs, photos) on a bill, expense, invoice, offer,
 *   order, customer, supplier or manual entry. Removing one only marks it, so
 *   it can come back from the recycle bin; after 90 days it is deleted.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE businesses ADD COLUMN stamp_media_id UUID REFERENCES media(id) ON DELETE SET NULL`.execute(db);
  await sql`ALTER TABLE businesses ADD COLUMN signature_media_id UUID REFERENCES media(id) ON DELETE SET NULL`.execute(db);

  await sql`
    INSERT INTO document_numbers (kind, year, last_number)
    SELECT 'offer', substring(number from 4 for 4)::smallint, max(substring(number from 9)::int)
    FROM offers
    WHERE number ~ '^OF-[0-9]{4}-[0-9]+$'
    GROUP BY 2
    ON CONFLICT DO NOTHING
  `.execute(db);

  await sql`
    CREATE TABLE attachments (
      id SERIAL PRIMARY KEY,
      entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('bill', 'expense', 'document', 'offer', 'order', 'customer', 'supplier', 'entry')),
      entity_id INT NOT NULL,
      media_id UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      mime VARCHAR(100) NOT NULL,
      size INT NOT NULL,
      added_by INT REFERENCES users(id),
      added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      removed_at TIMESTAMPTZ,
      removed_by INT REFERENCES users(id)
    )
  `.execute(db);
  await sql`CREATE INDEX attachments_entity ON attachments (entity_type, entity_id) WHERE removed_at IS NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS attachments`.execute(db);
  await sql`DELETE FROM document_numbers WHERE kind = 'offer'`.execute(db);
  await sql`ALTER TABLE businesses DROP COLUMN IF EXISTS signature_media_id`.execute(db);
  await sql`ALTER TABLE businesses DROP COLUMN IF EXISTS stamp_media_id`.execute(db);
}
