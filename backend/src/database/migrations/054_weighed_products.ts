import { type Kysely, sql } from 'kysely';

/**
 * Weighed products: a product is sold by the piece (as before) or by the kilo.
 *
 * - `products.unit`: 'piece' or 'kg'. Prices of a kg product are per kilo.
 * - `products.scale_plu`: the number the shop's scale prints in its labels
 *   (2 + PLU + weight in grams), so a scanned label finds the product.
 * - Quantities that a kilo product can have in part (sales, returns, stock,
 *   stock changes and counts, write-offs, bill, order and invoice lines,
 *   counter events) become double precision, kept to three decimals by the
 *   app. A piece product still only moves in whole numbers (the app checks).
 * - `sales.total_amount` is rounded to the cent, since 0.775 kg × €8.20 isn't.
 *
 * The sales_ledger view and the generated total depend on these columns, so
 * both are taken down and put back as they were.
 */
const COLUMNS: Array<[table: string, column: string]> = [
  ['sales', 'quantity_sold'],
  ['returns', 'quantity'],
  ['inventory', 'quantity_on_hand'],
  ['stock_adjustments', 'adjustment_quantity'],
  ['stock_count_lines', 'counted_quantity'],
  ['stock_count_lines', 'expected_quantity'],
  ['write_offs', 'quantity'],
  ['bill_lines', 'quantity'],
  ['purchase_order_lines', 'quantity'],
  ['purchase_order_lines', 'received_quantity'],
  ['document_lines', 'quantity'],
  ['counter_events', 'quantity'],
];

async function ledgerView(db: Kysely<unknown>): Promise<string> {
  const { rows } = await sql<{ def: string }>`select pg_get_viewdef('sales_ledger'::regclass) as def`.execute(db);
  return rows[0]!.def;
}

async function retype(db: Kysely<unknown>, type: 'double precision' | 'integer', totalExpression: string): Promise<void> {
  const view = await ledgerView(db);
  await sql`DROP VIEW sales_ledger`.execute(db);
  await sql`ALTER TABLE sales DROP COLUMN total_amount`.execute(db);
  for (const [table, column] of COLUMNS) {
    const using = type === 'integer' ? sql`USING round(${sql.ref(column)})::integer` : sql``;
    await sql`ALTER TABLE ${sql.table(table)} ALTER COLUMN ${sql.ref(column)} TYPE ${sql.raw(type)} ${using}`.execute(db);
  }
  await sql`ALTER TABLE sales ADD COLUMN total_amount numeric GENERATED ALWAYS AS (${sql.raw(totalExpression)}) STORED`.execute(db);
  await sql`CREATE VIEW sales_ledger AS ${sql.raw(view.replace(/;\s*$/, ''))}`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE products ADD COLUMN unit varchar(10) NOT NULL DEFAULT 'piece' CHECK (unit IN ('piece', 'kg'))`.execute(db);
  await sql`ALTER TABLE products ADD COLUMN scale_plu integer CHECK (scale_plu BETWEEN 1 AND 99999)`.execute(db);
  await sql`CREATE UNIQUE INDEX products_scale_plu_unique ON products (scale_plu) WHERE scale_plu IS NOT NULL AND deleted_at IS NULL`.execute(db);
  await retype(db, 'double precision', 'round(quantity_sold::numeric * price_per_unit, 2)');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await retype(db, 'integer', 'quantity_sold::numeric * price_per_unit');
  await sql`DROP INDEX products_scale_plu_unique`.execute(db);
  await sql`ALTER TABLE products DROP COLUMN scale_plu`.execute(db);
  await sql`ALTER TABLE products DROP COLUMN unit`.execute(db);
}
