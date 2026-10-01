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

  async create(productId: number, quantityOnHand: number, reorderLevel: number): Promise<void> {
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

  /**
   * Add `delta` (negative to remove) in a single UPDATE. The WHERE clause makes
   * the database refuse to go below zero even if two people adjust the same
   * product at the same moment. Returns undefined when that would happen.
   */
  async applyDelta(productId: number, delta: number): Promise<{ before: number; after: number } | undefined> {
    const row = await this.db
      .updateTable('inventory')
      .set((eb) => ({
        quantity_on_hand: eb('quantity_on_hand', '+', delta),
        updated_at: new Date(),
        ...(delta > 0 && { last_restocked_at: new Date() }),
      }))
      .where('product_id', '=', productId)
      .where(sql<boolean>`quantity_on_hand + ${delta} >= 0`)
      .returning('quantity_on_hand')
      .executeTakeFirst();
    return row ? { before: row.quantity_on_hand - delta, after: row.quantity_on_hand } : undefined;
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
