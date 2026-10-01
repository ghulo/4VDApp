import { type Kysely, sql } from 'kysely';

/**
 * Returns, write-offs and stock counts, each with its own approval status
 * (see docs/superpowers/specs/2026-10-01-returns-and-stock-counts-design.md).
 *
 * - settings: owner-editable limits, e.g. when a refund needs approval.
 * - sales_ledger: sales plus approved returns as negative rows, so every
 *   money report reads one source and a refund counts on the day it was approved.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const approvalColumns = sql`
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by INT REFERENCES users(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by INT REFERENCES users(id),
    decided_at TIMESTAMPTZ,
    decision_note TEXT`;

  const statements = [
    sql`CREATE TABLE settings (
      key VARCHAR(100) PRIMARY KEY,
      value JSONB NOT NULL,
      updated_by INT REFERENCES users(id),
      updated_at TIMESTAMPTZ
    )`,
    sql`INSERT INTO settings (key, value) VALUES ('refund_approval_limit', '50'), ('return_window_days', '14')`,
    sql`CREATE TABLE returns (
      id SERIAL PRIMARY KEY,
      sale_id INT NOT NULL REFERENCES sales(id),
      quantity INT NOT NULL CHECK (quantity > 0),
      refund_amount DECIMAL(12, 2) NOT NULL CHECK (refund_amount >= 0),
      condition VARCHAR(20) NOT NULL CHECK (condition IN ('resellable', 'damaged')),
      notes TEXT,
      ${approvalColumns}
    )`,
    sql`CREATE TABLE write_offs (
      id SERIAL PRIMARY KEY,
      product_id INT NOT NULL REFERENCES products(id),
      quantity INT NOT NULL CHECK (quantity > 0),
      reason VARCHAR(20) NOT NULL CHECK (reason IN ('damaged', 'lost', 'expired', 'other')),
      unit_cost DECIMAL(10, 2) CHECK (unit_cost >= 0),
      return_id INT REFERENCES returns(id),
      notes TEXT,
      ${approvalColumns}
    )`,
    sql`CREATE TABLE stock_counts (
      id SERIAL PRIMARY KEY,
      category_id INT REFERENCES categories(id),
      status VARCHAR(20) NOT NULL CHECK (status IN ('open', 'submitted', 'closed', 'cancelled')),
      started_by INT REFERENCES users(id),
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      submitted_by INT REFERENCES users(id),
      submitted_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ
    )`,
    sql`CREATE TABLE stock_count_lines (
      id SERIAL PRIMARY KEY,
      count_id INT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id),
      counted_quantity INT NOT NULL CHECK (counted_quantity >= 0),
      expected_quantity INT NOT NULL,
      unit_cost DECIMAL(10, 2) CHECK (unit_cost >= 0),
      counted_by INT REFERENCES users(id),
      counted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      status VARCHAR(20) CHECK (status IN ('match', 'pending', 'approved', 'rejected')),
      decided_by INT REFERENCES users(id),
      decided_at TIMESTAMPTZ,
      decision_note TEXT,
      UNIQUE (count_id, product_id)
    )`,
    sql`CREATE INDEX idx_returns_sale ON returns(sale_id)`,
    sql`CREATE INDEX idx_returns_status ON returns(status)`,
    sql`CREATE INDEX idx_write_offs_status ON write_offs(status)`,
    sql`CREATE INDEX idx_stock_counts_status ON stock_counts(status)`,
    sql`CREATE INDEX idx_count_lines_count ON stock_count_lines(count_id)`,
    sql`CREATE VIEW sales_ledger AS
      SELECT s.id AS sale_id, NULL::int AS return_id, s.product_id, s.sold_by,
             s.sale_date AS occurred_at, s.quantity_sold AS units,
             s.total_amount AS revenue, s.unit_cost,
             s.quantity_sold * s.unit_cost AS cost
      FROM sales s
      UNION ALL
      SELECT s.id, r.id, s.product_id, s.sold_by,
             r.decided_at, -r.quantity, -r.refund_amount, s.unit_cost,
             -r.quantity * s.unit_cost
      FROM returns r JOIN sales s ON s.id = r.sale_id
      WHERE r.status = 'approved'`,
  ];

  for (const statement of statements) {
    await statement.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP VIEW IF EXISTS sales_ledger`.execute(db);
  for (const table of ['stock_count_lines', 'stock_counts', 'write_offs', 'returns', 'settings']) {
    await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(db);
  }
}
