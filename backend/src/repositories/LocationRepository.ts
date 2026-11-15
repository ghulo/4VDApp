import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export interface LocationRecord {
  id: number;
  name: string;
  sells_here: boolean;
  receives_here: boolean;
  removed_at: Date | null;
  /** Units of all products here. */
  units: number;
  /** Products with stock here. */
  products: number;
}

/** Where stock is kept: the shop floor and any storerooms. */
export class LocationRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** The locations in use (removed ones too when asked), the selling one first. */
  list(withRemoved = false): Promise<LocationRecord[]> {
    let query = this.db
      .selectFrom('stock_locations as l')
      .select([
        'l.id',
        'l.name',
        'l.sells_here',
        'l.receives_here',
        'l.removed_at',
        sql<number>`(select coalesce(sum(s.quantity), 0)::float8 from location_stock s where s.location_id = l.id)`.as('units'),
        sql<number>`(select count(*)::int from location_stock s where s.location_id = l.id and s.quantity > 0)`.as('products'),
      ]);
    if (!withRemoved) query = query.where('l.removed_at', 'is', null);
    return query.orderBy('l.sells_here', 'desc').orderBy('l.id').execute();
  }

  findById(id: number): Promise<LocationRecord | undefined> {
    return this.list(true).then((rows) => rows.find((row) => row.id === id));
  }

  /** Where the till sells from. */
  async sellingId(): Promise<number> {
    const row = await this.db.selectFrom('stock_locations').select('id').where('sells_here', '=', true).executeTakeFirstOrThrow();
    return row.id;
  }

  /** Where goods come in unless another location is picked. */
  async receivingId(): Promise<number> {
    const row = await this.db.selectFrom('stock_locations').select('id').where('receives_here', '=', true).executeTakeFirstOrThrow();
    return row.id;
  }

  /** How many locations are in use: with one, no location is shown anywhere. */
  async countInUse(): Promise<number> {
    const row = await this.db.selectFrom('stock_locations').select((eb) => eb.fn.countAll<string>().as('n')).where('removed_at', 'is', null).executeTakeFirstOrThrow();
    return Number(row.n);
  }

  /** Names of every location, removed ones included, for history lines. */
  async names(): Promise<Map<number, string>> {
    const rows = await this.db.selectFrom('stock_locations').select(['id', 'name']).execute();
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async create(name: string): Promise<number> {
    const row = await this.db.insertInto('stock_locations').values({ name }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  async rename(id: number, name: string): Promise<void> {
    await this.db.updateTable('stock_locations').set({ name }).where('id', '=', id).execute();
  }

  /** Make this the one location with `flag` set. */
  async setOnly(id: number, flag: 'sells_here' | 'receives_here'): Promise<void> {
    await this.db.updateTable('stock_locations').set({ [flag]: false }).where(flag, '=', true).where('id', '<>', id).execute();
    await this.db.updateTable('stock_locations').set({ [flag]: true }).where('id', '=', id).execute();
  }

  async remove(id: number, now: Date): Promise<void> {
    await this.db.deleteFrom('location_stock').where('location_id', '=', id).where('quantity', '=', 0).execute();
    await this.db.updateTable('stock_locations').set({ removed_at: now }).where('id', '=', id).execute();
  }

  /** The shelf minimum of a product in a location (null clears it). */
  async setShelfMinimum(productId: number, locationId: number, minimum: number | null): Promise<void> {
    await this.db
      .insertInto('location_stock')
      .values({ location_id: locationId, product_id: productId, quantity: 0, shelf_minimum: minimum })
      .onConflict((oc) => oc.columns(['location_id', 'product_id']).doUpdateSet({ shelf_minimum: minimum, updated_at: new Date() }))
      .execute();
  }

  async createMove(move: { number: string; fromId: number; toId: number; day: string; note: string | null; createdBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('stock_moves')
      .values({ number: move.number, from_location_id: move.fromId, to_location_id: move.toId, day: move.day, note: move.note, created_by: move.createdBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async addMoveLine(moveId: number, productId: number, quantity: number): Promise<void> {
    await this.db.insertInto('stock_move_lines').values({ move_id: moveId, product_id: productId, quantity }).execute();
  }

  /** False when it was already voided. */
  async voidMove(id: number, by: number, now: Date): Promise<boolean> {
    const row = await this.db.updateTable('stock_moves').set({ voided_at: now, voided_by: by }).where('id', '=', id).where('voided_at', 'is', null).returning('id').executeTakeFirst();
    return row !== undefined;
  }

  /** A product's stock in each location in use, with its shelf minimum. */
  forProduct(productId: number) {
    return this.db
      .selectFrom('stock_locations as l')
      .leftJoin('location_stock as s', (join) => join.onRef('s.location_id', '=', 'l.id').on('s.product_id', '=', productId))
      .select(['l.id', 'l.name', 'l.sells_here', sql<number>`coalesce(s.quantity, 0)`.as('quantity'), 's.shelf_minimum'])
      .where((eb) => eb.or([eb('l.removed_at', 'is', null), eb('s.quantity', '>', 0)]))
      .orderBy('l.sells_here', 'desc')
      .orderBy('l.id')
      .execute();
  }
}

/**
 * For scripts that write `inventory` directly (the demo seed, the TREFIN
 * import): put the stock of every product that has no location yet into the
 * location the till sells from, so the locations add up to the total.
 */
export async function placeUnlocatedStock(db: DatabaseClient): Promise<void> {
  await sql`
    INSERT INTO location_stock (location_id, product_id, quantity)
    SELECT (SELECT id FROM stock_locations WHERE sells_here), i.product_id, i.quantity_on_hand
    FROM inventory i
    WHERE NOT EXISTS (SELECT 1 FROM location_stock s WHERE s.product_id = i.product_id)
  `.execute(db);
}
