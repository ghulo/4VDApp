import { type Kysely, sql } from 'kysely';

/**
 * Products made here from other products: a gift basket from rakia and honey,
 * a pack of six from single bottles. A recipe lists what goes into one; a made
 * product may itself be a part (semi-finished goods). A Make document takes
 * the parts out of one location and puts the made product in there, at the
 * summed cost of its parts. Parts and product both sit in stock, so a Make
 * writes nothing in the books. Voiding puts everything back and restores the
 * cost the made product had before.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE recipe_parts (
      product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      part_id INT NOT NULL REFERENCES products(id),
      quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
      position SMALLINT NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, part_id),
      CHECK (product_id <> part_id)
    )
  `.execute(db);
  await sql`CREATE INDEX recipe_parts_part_idx ON recipe_parts (part_id)`.execute(db);
  await sql`
    CREATE TABLE makes (
      id SERIAL PRIMARY KEY,
      number VARCHAR(40) NOT NULL UNIQUE,
      product_id INT NOT NULL REFERENCES products(id),
      quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
      unit_cost NUMERIC(12, 2) NOT NULL CHECK (unit_cost >= 0),
      cost_before NUMERIC(12, 2),
      day DATE NOT NULL,
      location_id INT REFERENCES stock_locations(id),
      expires_on DATE,
      note TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_at TIMESTAMPTZ,
      voided_by INT REFERENCES users(id) ON DELETE SET NULL
    )
  `.execute(db);
  await sql`CREATE INDEX makes_day_idx ON makes (day)`.execute(db);
  await sql`
    CREATE TABLE make_lines (
      id SERIAL PRIMARY KEY,
      make_id INT NOT NULL REFERENCES makes(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id),
      quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
      unit_cost NUMERIC(12, 2) NOT NULL CHECK (unit_cost >= 0)
    )
  `.execute(db);
  await sql`CREATE INDEX make_lines_make_idx ON make_lines (make_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS make_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS makes`.execute(db);
  await sql`DROP TABLE IF EXISTS recipe_parts`.execute(db);
}
