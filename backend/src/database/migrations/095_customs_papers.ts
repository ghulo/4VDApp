import { type Kysely, sql } from 'kysely';

/**
 * Customs papers for goods from abroad (Dogana e Kosovës' declaration).
 *
 * - customs_papers: one declaration. `bill_id` is the import bill it covers;
 *   null while it waits to be matched (scanned before its bill was entered).
 *   It posts on its own date, so its VAT counts in its own month (a paper dated
 *   in a filed month counts in the next open one, `vat_month`, like a late bill).
 *   `excise` is kept apart for the record; it lands on the goods like the duty.
 *   `invoice_numbers`, `supplier_name` and `declared_value` are what the scanner
 *   read, used to find the bill.
 * - bill_lines.duty: each goods line's share of the duty and excise (already in
 *   `landed`); `duty_expensed`: the part of it that went to cost of sales
 *   because none of the line's units were left in stock when it came.
 * - supplier_bills.no_customs: the owner says this import had no customs paper
 *   (under the limit), so 4VD stops asking for one.
 *
 * The old customs columns on supplier_bills are copied into papers and no
 * longer read; they are dropped in a later migration, once no running server
 * reads them.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // bill_lines and supplier_bills get columns: wait a little for a lock, never block sales.
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    CREATE TABLE customs_papers (
      id SERIAL PRIMARY KEY,
      business_id INT NOT NULL DEFAULT current_business_id() REFERENCES businesses(id),
      bill_id INT REFERENCES supplier_bills(id),
      number VARCHAR(60),
      issued_on DATE NOT NULL,
      vat_month DATE,
      vat NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (vat >= 0),
      duty NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (duty >= 0),
      excise NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (excise >= 0),
      paid_method VARCHAR(12) NOT NULL DEFAULT 'bank' CHECK (paid_method IN ('bank', 'cash')),
      scan_id INT REFERENCES bill_scans(id) ON DELETE SET NULL,
      supplier_name VARCHAR(200),
      invoice_numbers TEXT[] NOT NULL DEFAULT '{}',
      declared_value NUMERIC(12, 2),
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_at TIMESTAMPTZ
    )
  `.execute(db);
  // One paper per bill; a voided one steps aside.
  await sql`CREATE UNIQUE INDEX customs_papers_one_per_bill ON customs_papers (bill_id) WHERE voided_at IS NULL AND bill_id IS NOT NULL`.execute(db);
  await sql`CREATE INDEX customs_papers_waiting ON customs_papers (business_id) WHERE voided_at IS NULL AND bill_id IS NULL`.execute(db);
  await sql`SELECT protect_business_table('customs_papers')`.execute(db);
  await sql`
    CREATE TRIGGER customs_papers_ledger AFTER INSERT OR UPDATE OR DELETE ON customs_papers
    FOR EACH ROW EXECUTE FUNCTION public.ledger_enqueue('customs_papers', 'id')
  `.execute(db);

  await sql`
    ALTER TABLE bill_lines
      ADD COLUMN duty NUMERIC(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN duty_expensed NUMERIC(12, 2) NOT NULL DEFAULT 0
  `.execute(db);
  await sql`ALTER TABLE supplier_bills ADD COLUMN no_customs BOOLEAN NOT NULL DEFAULT false`.execute(db);

  // Customs typed on the bill form before: a paper dated with its bill.
  await sql`
    INSERT INTO customs_papers (business_id, bill_id, issued_on, vat_month, vat, duty, paid_method, created_by, created_at)
    SELECT b.business_id, b.id, b.issued_on, b.vat_month, coalesce(b.customs_vat, 0), coalesce(b.customs_duty, 0), coalesce(b.customs_paid_method, 'bank'), b.created_by, b.created_at
    FROM supplier_bills b
    WHERE b.customs_paid_method IS NOT NULL AND coalesce(b.customs_vat, 0) + coalesce(b.customs_duty, 0) > 0
  `.execute(db);
  // Each goods line's share of the duty: by value, as the bill form spread it; the last line takes the rounding.
  await sql`
    WITH goods AS (
      SELECT l.id, l.bill_id, l.net, p.duty,
        sum(l.net) OVER (PARTITION BY l.bill_id) AS total,
        row_number() OVER (PARTITION BY l.bill_id ORDER BY l.position DESC, l.id DESC) AS from_end
      FROM bill_lines l
      JOIN customs_papers p ON p.bill_id = l.bill_id AND p.voided_at IS NULL
      WHERE l.kind IN ('product', 'equipment') AND p.duty > 0
    ),
    shares AS (
      SELECT id, bill_id, from_end, duty, CASE WHEN total > 0 THEN round(duty * net / total, 2) ELSE 0 END AS share FROM goods
    )
    UPDATE bill_lines l SET duty = CASE
      WHEN s.from_end = 1 THEN s.duty - coalesce((SELECT sum(o.share) FROM shares o WHERE o.bill_id = s.bill_id AND o.from_end > 1), 0)
      ELSE s.share END
    FROM shares s WHERE s.id = l.id
  `.execute(db);
  // Their bills post again without the customs, which now posts on its own.
  await sql`
    INSERT INTO ledger_queue (business_id, source_table, row_id)
    SELECT business_id, 'supplier_bills', bill_id FROM customs_papers
    ON CONFLICT DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM ledger_queue WHERE source_table = 'customs_papers'`.execute(db);
  await sql`DELETE FROM ledger_entries WHERE source_key LIKE 'customs:%'`.execute(db);
  await sql`ALTER TABLE supplier_bills DROP COLUMN no_customs`.execute(db);
  await sql`ALTER TABLE bill_lines DROP COLUMN duty, DROP COLUMN duty_expensed`.execute(db);
  await sql`DROP TABLE customs_papers`.execute(db);
}
