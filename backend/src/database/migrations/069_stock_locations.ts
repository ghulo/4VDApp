import { type Kysely, sql } from 'kysely';

/**
 * Stock in several locations: the shop floor plus storerooms the owner adds.
 * `inventory.quantity_on_hand` stays the product's total, so everything that
 * reads it keeps working; `location_stock` holds how much of it is where, and
 * both change together in one place (InventoryRepository.applyDelta). One
 * location sells (the till takes from it) and one receives (where goods come in
 * by default). A location is removed only when empty; removed ones stay for the
 * history. Moving stock between locations is a numbered document (LV-) that
 * never touches the books. Everything there is today goes into "Shop floor".
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE stock_locations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(60) NOT NULL CHECK (btrim(name) <> ''),
      sells_here BOOLEAN NOT NULL DEFAULT false,
      receives_here BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      removed_at TIMESTAMPTZ
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX stock_locations_name_idx ON stock_locations (lower(name)) WHERE removed_at IS NULL`.execute(db);
  await sql`CREATE UNIQUE INDEX stock_locations_sells_idx ON stock_locations (sells_here) WHERE sells_here`.execute(db);
  await sql`CREATE UNIQUE INDEX stock_locations_receives_idx ON stock_locations (receives_here) WHERE receives_here`.execute(db);
  await sql`INSERT INTO stock_locations (name, sells_here, receives_here) VALUES ('Shop floor', true, true)`.execute(db);

  await sql`
    CREATE TABLE location_stock (
      location_id INT NOT NULL REFERENCES stock_locations(id),
      product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      shelf_minimum DOUBLE PRECISION CHECK (shelf_minimum >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (location_id, product_id)
    )
  `.execute(db);
  await sql`CREATE INDEX location_stock_product_idx ON location_stock (product_id)`.execute(db);
  await sql`
    INSERT INTO location_stock (location_id, product_id, quantity)
    SELECT (SELECT id FROM stock_locations WHERE sells_here), product_id, quantity_on_hand FROM inventory
  `.execute(db);

  await sql`ALTER TABLE stock_adjustments ADD COLUMN location_id INT REFERENCES stock_locations(id)`.execute(db);
  await sql`UPDATE stock_adjustments SET location_id = (SELECT id FROM stock_locations WHERE sells_here)`.execute(db);
  for (const table of ['stock_documents', 'write_offs', 'stock_counts', 'supplier_bills']) {
    await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN location_id INT REFERENCES stock_locations(id)`.execute(db);
  }

  await sql`
    CREATE TABLE stock_moves (
      id SERIAL PRIMARY KEY,
      number VARCHAR(40) NOT NULL UNIQUE,
      from_location_id INT NOT NULL REFERENCES stock_locations(id),
      to_location_id INT NOT NULL REFERENCES stock_locations(id),
      day DATE NOT NULL,
      note TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_at TIMESTAMPTZ,
      voided_by INT REFERENCES users(id) ON DELETE SET NULL,
      CHECK (from_location_id <> to_location_id)
    )
  `.execute(db);
  await sql`CREATE INDEX stock_moves_day_idx ON stock_moves (day)`.execute(db);
  await sql`
    CREATE TABLE stock_move_lines (
      id SERIAL PRIMARY KEY,
      move_id INT NOT NULL REFERENCES stock_moves(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id),
      quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0)
    )
  `.execute(db);
  await sql`CREATE INDEX stock_move_lines_move_idx ON stock_move_lines (move_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS stock_move_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS stock_moves`.execute(db);
  for (const table of ['supplier_bills', 'stock_counts', 'write_offs', 'stock_documents', 'stock_adjustments']) {
    await sql`ALTER TABLE ${sql.table(table)} DROP COLUMN IF EXISTS location_id`.execute(db);
  }
  await sql`DROP TABLE IF EXISTS location_stock`.execute(db);
  await sql`DROP TABLE IF EXISTS stock_locations`.execute(db);
}
