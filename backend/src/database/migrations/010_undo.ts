import { type Kysely, sql } from 'kysely';

/**
 * Undo: a sale, return, write-off, count line or log entry (manual stock
 * changes and edits) can be marked undone, and restored, instead of deleted,
 * so the history of what happened stays. Money reports read `sales_ledger`,
 * which now leaves out undone sales and returns.
 */
const TABLES = ['sales', 'returns', 'write_offs', 'stock_count_lines', 'activity_log'];

const LEDGER = (excludeUndone: boolean) => sql`CREATE VIEW sales_ledger AS
  SELECT s.id AS sale_id, NULL::int AS return_id, s.product_id, s.sold_by,
         s.sale_date AS occurred_at, s.quantity_sold AS units,
         s.total_amount AS revenue, s.unit_cost, s.quantity_sold * s.unit_cost AS cost
  FROM sales s
  ${excludeUndone ? sql`WHERE s.undone_at IS NULL` : sql``}
  UNION ALL
  SELECT s.id, r.id, s.product_id, s.sold_by,
         r.decided_at, -r.quantity, -r.refund_amount, s.unit_cost, -r.quantity * s.unit_cost
  FROM returns r JOIN sales s ON s.id = r.sale_id
  WHERE r.status = 'approved' ${excludeUndone ? sql`AND r.undone_at IS NULL AND s.undone_at IS NULL` : sql``}`;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of TABLES) {
    await sql`ALTER TABLE ${sql.table(table)}
      ADD COLUMN undone_at TIMESTAMPTZ,
      ADD COLUMN undone_by INT REFERENCES users(id),
      ADD COLUMN undo_note TEXT`.execute(db);
  }
  await sql`DROP VIEW IF EXISTS sales_ledger`.execute(db);
  await LEDGER(true).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP VIEW IF EXISTS sales_ledger`.execute(db);
  await LEDGER(false).execute(db);
  for (const table of TABLES) {
    await sql`ALTER TABLE ${sql.table(table)} DROP COLUMN undone_at, DROP COLUMN undone_by, DROP COLUMN undo_note`.execute(db);
  }
}
