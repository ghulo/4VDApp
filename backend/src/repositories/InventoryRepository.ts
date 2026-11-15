import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { escapeLikePattern } from '../utils/databaseErrors.js';

export interface InventoryFilters {
  lowStockOnly: boolean;
  search?: string;
  limit: number;
  offset: number;
}

export interface InventoryRecord {
  product_id: number;
  product_name: string;
  sku: string | null;
  image_url: string | null;
  quantity_on_hand: number;
  reorder_level: number;
  last_restocked_at: Date | null;
  updated_at: Date;
}

export class InventoryRepository {
  constructor(private readonly db: DatabaseClient) {}

  private baseQuery() {
    return this.db
      .selectFrom('inventory as i')
      .innerJoin('products as p', 'p.id', 'i.product_id')
      .where('p.deleted_at', 'is', null);
  }

  private readonly columns = [
    'i.product_id',
    'p.name as product_name',
    'p.sku',
    'p.image_url',
    'i.quantity_on_hand',
    'i.reorder_level',
    'i.last_restocked_at',
    'i.updated_at',
  ] as const;

  async findMany(filters: InventoryFilters): Promise<{ items: InventoryRecord[]; total: number }> {
    let query = this.baseQuery();
    if (filters.lowStockOnly) query = query.whereRef('i.quantity_on_hand', '<=', 'i.reorder_level');
    if (filters.search) {
      const pattern = `%${escapeLikePattern(filters.search)}%`;
      query = query.where((eb) => eb.or([eb('p.name', 'ilike', pattern), eb('p.sku', 'ilike', pattern)]));
    }

    const [items, count] = await Promise.all([
      // Emptiest first relative to its reorder level, so problems are on top.
      query
        .select(this.columns)
        .orderBy(sql`i.quantity_on_hand - i.reorder_level`)
        .orderBy('p.name')
        .limit(filters.limit)
        .offset(filters.offset)
        .execute(),
      query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
    ]);
    return { items, total: Number(count.total) };
  }

  findByProductId(productId: number): Promise<InventoryRecord | undefined> {
    return this.baseQuery().select(this.columns).where('i.product_id', '=', productId).executeTakeFirst();
  }

  /** A new product's stock record; any starting stock goes into the location that receives goods. */
  async create(productId: number, quantityOnHand: number, reorderLevel: number): Promise<void> {
    await this.db
      .insertInto('location_stock')
      .values((eb) => ({
        location_id: eb.selectFrom('stock_locations').select('id').where('receives_here', '=', true),
        product_id: productId,
        quantity: quantityOnHand,
      }))
      .execute();
    await this.db
      .insertInto('inventory')
      .values({
        product_id: productId,
        quantity_on_hand: quantityOnHand,
        reorder_level: reorderLevel,
        last_restocked_at: quantityOnHand > 0 ? new Date() : null,
      })
      .execute();
  }

  /** What is on the shelf now (all locations), locked until the transaction ends. */
  async onHandForUpdate(productId: number): Promise<number> {
    const row = await this.db.selectFrom('inventory').select('quantity_on_hand').where('product_id', '=', productId).forUpdate().executeTakeFirst();
    return row?.quantity_on_hand ?? 0;
  }

  /**
   * Add `delta` (negative to remove) to one location and to the product's
   * total, together. The WHERE clauses make the database refuse to go below
   * zero in either, even if two people change the same product at the same
   * moment. Returns the total before and after, or undefined when that would happen.
   */
  async applyDelta(productId: number, locationId: number, delta: number): Promise<{ before: number; after: number } | undefined> {
    if (!(await this.changeAt(productId, locationId, delta))) return undefined;
    const row = await this.db
      .updateTable('inventory')
      .set({
        // Kilos are kept to the gram, so sums never drift (0.1 + 0.2).
        quantity_on_hand: sql<number>`round((quantity_on_hand + ${delta})::numeric, 3)::float8`,
        updated_at: new Date(),
        ...(delta > 0 && { last_restocked_at: new Date() }),
      })
      .where('product_id', '=', productId)
      .where(sql<boolean>`round((quantity_on_hand + ${delta})::numeric, 3) >= 0`)
      .returning('quantity_on_hand')
      .executeTakeFirst();
    return row ? { before: Math.round((row.quantity_on_hand - delta) * 1000) / 1000, after: row.quantity_on_hand } : undefined;
  }

  /** Change one location only (a move between locations leaves the total alone). False when it would go below zero. */
  async changeAt(productId: number, locationId: number, delta: number): Promise<boolean> {
    if (delta >= 0) {
      await this.db
        .insertInto('location_stock')
        .values({ location_id: locationId, product_id: productId, quantity: delta })
        .onConflict((oc) =>
          oc.columns(['location_id', 'product_id']).doUpdateSet({
            quantity: sql<number>`round((location_stock.quantity + ${delta})::numeric, 3)::float8`,
            updated_at: new Date(),
          }),
        )
        .execute();
      return true;
    }
    const row = await this.db
      .updateTable('location_stock')
      .set({ quantity: sql<number>`round((quantity + ${delta})::numeric, 3)::float8`, updated_at: new Date() })
      .where('location_id', '=', locationId)
      .where('product_id', '=', productId)
      .where(sql<boolean>`round((quantity + ${delta})::numeric, 3) >= 0`)
      .returning('quantity')
      .executeTakeFirst();
    return row !== undefined;
  }

  /** How much of this product each location holds, locked until the transaction ends. */
  byLocationForUpdate(productId: number): Promise<Array<{ location_id: number; quantity: number }>> {
    // Only this product's rows are locked, never the location itself, so other products sell on.
    return this.db
      .selectFrom('location_stock')
      .select(['location_id', 'quantity'])
      .where('product_id', '=', productId)
      .orderBy('location_id')
      .forUpdate()
      .execute();
  }

  /** How much is in one location (0 when it never had any). */
  async quantityAt(productId: number, locationId: number): Promise<number> {
    const row = await this.db
      .selectFrom('location_stock')
      .select('quantity')
      .where('product_id', '=', productId)
      .where('location_id', '=', locationId)
      .executeTakeFirst();
    return row?.quantity ?? 0;
  }

  async setReorderLevel(productId: number, reorderLevel: number): Promise<void> {
    await this.db
      .updateTable('inventory')
      .set({ reorder_level: reorderLevel, updated_at: new Date() })
      .where('product_id', '=', productId)
      .execute();
  }

  /** Total stock value at cost (falls back to sale price when cost is unknown). */
  async totalValue(): Promise<number> {
    const row = await this.baseQuery()
      .select(sql<string>`coalesce(sum(i.quantity_on_hand * coalesce(p.cost_price, p.base_price)), 0)`.as('value'))
      .executeTakeFirstOrThrow();
    return Number(row.value);
  }
}
