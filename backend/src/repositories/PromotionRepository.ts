import type { DatabaseClient } from '../database/connection.js';
import type { RunningPromotion } from '../services/pricing/promotions.js';

export interface PromotionRecord {
  id: number;
  name: string;
  percent_off: string;
  product_id: number | null;
  product_name: string | null;
  category_id: number | null;
  category_name: string | null;
  starts_at: Date;
  ends_at: Date;
  ended_early_at: Date | null;
  created_by_name: string | null;
  created_at: Date;
}

export interface NewPromotion {
  name: string;
  percentOff: number;
  productId: number | null;
  categoryId: number | null;
  startsAt: Date;
  endsAt: Date;
  createdBy: number;
}

/** A product a promotion would cover, with what the margin check needs. */
export interface CoveredProduct {
  id: number;
  name: string;
  base_price: string;
  cost_price: string | null;
}

export class PromotionRepository {
  constructor(private readonly db: DatabaseClient) {}

  private baseQuery() {
    return this.db
      .selectFrom('promotions as pr')
      .leftJoin('products as p', 'p.id', 'pr.product_id')
      .leftJoin('categories as c', 'c.id', 'pr.category_id')
      .leftJoin('users as u', 'u.id', 'pr.created_by')
      .select([
        'pr.id',
        'pr.name',
        'pr.percent_off',
        'pr.product_id',
        'p.name as product_name',
        'pr.category_id',
        'c.name as category_name',
        'pr.starts_at',
        'pr.ends_at',
        'pr.ended_early_at',
        'u.name as created_by_name',
        'pr.created_at',
      ]);
  }

  /** Newest first. Finished ones stay listed for the record. */
  async findAll(): Promise<PromotionRecord[]> {
    return this.baseQuery().orderBy('pr.starts_at', 'desc').orderBy('pr.id', 'desc').execute();
  }

  async findById(id: number): Promise<PromotionRecord | undefined> {
    return this.baseQuery().where('pr.id', '=', id).executeTakeFirst();
  }

  /** Promotions in force at `at`. There are only ever a handful, so callers filter in memory. */
  async findRunning(at: Date): Promise<RunningPromotion[]> {
    const rows = await this.db
      .selectFrom('promotions')
      .select(['id', 'name', 'percent_off', 'product_id', 'category_id', 'ends_at'])
      .where('starts_at', '<=', at)
      .where('ends_at', '>', at)
      .where((eb) => eb.or([eb('ended_early_at', 'is', null), eb('ended_early_at', '>', at)]))
      .execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      percentOff: Number(row.percent_off),
      productId: row.product_id,
      categoryId: row.category_id,
      endsAt: row.ends_at,
    }));
  }

  /** Live, visible products the promotion would apply to. */
  async coveredProducts(target: { productId: number | null; categoryId: number | null }): Promise<CoveredProduct[]> {
    let query = this.db
      .selectFrom('products')
      .select(['id', 'name', 'base_price', 'cost_price'])
      .where('deleted_at', 'is', null);
    query = target.productId
      ? query.where('id', '=', target.productId)
      : query.where('category_id', '=', target.categoryId!);
    return query.orderBy('name').execute();
  }

  async create(promotion: NewPromotion): Promise<number> {
    const row = await this.db
      .insertInto('promotions')
      .values({
        name: promotion.name,
        percent_off: promotion.percentOff,
        product_id: promotion.productId,
        category_id: promotion.categoryId,
        starts_at: promotion.startsAt,
        ends_at: promotion.endsAt,
        created_by: promotion.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async endEarly(id: number, at: Date): Promise<void> {
    await this.db.updateTable('promotions').set({ ended_early_at: at }).where('id', '=', id).execute();
  }
}
