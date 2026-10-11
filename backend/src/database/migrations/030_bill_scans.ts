import { type Kysely, sql } from 'kysely';

/**
 * Scanned supplier bills. A photo or PDF of the paper bill is read by AI into
 * a header and lines; it waits as a scan until someone who runs the shop checks
 * it and confirms, which receives the delivery and saves the bill.
 *
 * supplier_product_codes is what 4VD learns from each confirmed scan: the
 * supplier's own code for a product, and how many pieces one of their units
 * holds (a box of 12), so the next bill from them matches by itself.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE bill_scans (
      id SERIAL PRIMARY KEY,
      status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'confirmed', 'discarded')),
      -- The pages as uploaded, in order: media ids of the photos or PDFs.
      media_ids TEXT[] NOT NULL,
      -- What the AI read off the bill, exactly as it returned it.
      reading JSONB NOT NULL,
      scanned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      decided_at TIMESTAMPTZ,
      bill_id INTEGER REFERENCES supplier_bills(id) ON DELETE SET NULL,
      order_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL
    )
  `.execute(db);
  await sql`CREATE INDEX idx_bill_scans_waiting ON bill_scans (scanned_at) WHERE status = 'waiting'`.execute(db);

  await sql`
    CREATE TABLE supplier_product_codes (
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      code VARCHAR(64) NOT NULL,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      units_per_pack INTEGER NOT NULL DEFAULT 1 CHECK (units_per_pack > 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (supplier_id, code)
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS supplier_product_codes`.execute(db);
  await sql`DROP TABLE IF EXISTS bill_scans`.execute(db);
}
