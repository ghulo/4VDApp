import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';

export interface OpenShortfall {
  productId: number;
  productName: string;
  /** All the pieces (or kilos) sold past what 4VD had, since the last count. */
  shortBy: number;
  lastSoldAt: Date;
}

/** Offline Counter sales that sold more than 4VD thought was on the shelf. */
export class OfflineShortfallRepository {
  constructor(private readonly db: DatabaseClient) {}

  async add(shortfall: { productId: number; saleId: number; shortBy: number; soldBy: number; soldAt: Date }): Promise<void> {
    await this.db
      .insertInto('offline_shortfalls')
      .values({
        product_id: shortfall.productId,
        sale_id: shortfall.saleId,
        short_by: shortfall.shortBy,
        sold_by: shortfall.soldBy,
        sold_at: shortfall.soldAt,
      })
      .execute();
  }

  /** Products still to count: a shortfall with no recount of the product after it. */
  async open(): Promise<OpenShortfall[]> {
    const { rows } = await sql<{ product_id: number; product_name: string; short_by: number; last_sold_at: Date }>`
      select f.product_id, p.name as product_name, round(sum(f.short_by)::numeric, 3)::float8 as short_by, max(f.sold_at) as last_sold_at
      from offline_shortfalls f
      join products p on p.id = f.product_id and p.deleted_at is null
      where not exists (
        select 1 from stock_adjustments a
        where a.product_id = f.product_id and a.reason = ${SYSTEM_STOCK_REASONS.RECOUNT} and a.created_at > f.created_at
      )
      group by f.product_id, p.name
      order by max(f.sold_at) desc
    `.execute(this.db);
    return rows.map((row) => ({ productId: row.product_id, productName: row.product_name, shortBy: row.short_by, lastSoldAt: row.last_sold_at }));
  }
}
