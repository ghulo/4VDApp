import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export interface BelowCostRow {
  product_id: number;
  product_name: string;
  sales_count: string;
  units: string;
  /** How much less than cost those sales brought in, in total. */
  shortfall: string;
}

export interface UnusualSaleRow {
  sale_id: number;
  product_id: number;
  product_name: string;
  quantity_sold: number;
  sale_date: Date;
  sold_by_name: string | null;
  usual_quantity: string;
}

export interface MissingStockRow {
  product_id: number;
  product_name: string;
  units: string;
  /** Separate count shortfalls and lost write-offs. */
  times: string;
}

/** The questions behind the warnings on the Overview page. */
export class InsightsRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Sales since `since` at a unit price below the cost at the time. */
  async salesBelowCost(since: Date): Promise<BelowCostRow[]> {
    const result = await sql<BelowCostRow>`
      select p.id as product_id, p.name as product_name,
             count(*) as sales_count, sum(s.quantity_sold) as units,
             sum((s.unit_cost - s.price_per_unit) * s.quantity_sold) as shortfall
      from sales s
      join products p on p.id = s.product_id
      where s.sale_date >= ${since} and s.unit_cost is not null and s.price_per_unit < s.unit_cost
      group by p.id, p.name
      order by shortfall desc
    `.execute(this.db);
    return result.rows;
  }

  /**
   * Sales since `since` of at least `minQuantity` units and `factor` times the
   * product's usual sale, judged on at least `minHistory` earlier sales from
   * `baselineSince`. Big one-offs can be typing mistakes or theft cover.
   */
  async unusualSales(input: {
    since: Date;
    baselineSince: Date;
    minQuantity: number;
    factor: number;
    minHistory: number;
  }): Promise<UnusualSaleRow[]> {
    const result = await sql<UnusualSaleRow>`
      select s.id as sale_id, p.id as product_id, p.name as product_name, s.quantity_sold, s.sale_date,
             u.name as sold_by_name, round(baseline.usual, 1) as usual_quantity
      from sales s
      join products p on p.id = s.product_id
      left join users u on u.id = s.sold_by
      cross join lateral (
        select avg(earlier.quantity_sold) as usual, count(*) as how_many
        from sales earlier
        where earlier.product_id = s.product_id
          and earlier.sale_date >= ${input.baselineSince} and earlier.sale_date < ${input.since}
      ) baseline
      where s.sale_date >= ${input.since}
        and s.quantity_sold >= ${input.minQuantity}
        and baseline.how_many >= ${input.minHistory}
        and s.quantity_sold >= ${input.factor} * baseline.usual
      order by s.sale_date desc
    `.execute(this.db);
    return result.rows;
  }

  /** Units that went missing since `since`: approved count shortfalls plus approved "lost" write-offs. */
  async missingStock(since: Date): Promise<MissingStockRow[]> {
    const result = await sql<MissingStockRow>`
      with missing as (
        select l.product_id, l.expected_quantity - l.counted_quantity as units
        from stock_count_lines l
        where l.status = 'approved' and l.decided_at >= ${since} and l.counted_quantity < l.expected_quantity
        union all
        select w.product_id, w.quantity
        from write_offs w
        where w.status = 'approved' and w.reason = 'lost' and w.decided_at >= ${since}
      )
      select p.id as product_id, p.name as product_name, sum(m.units) as units, count(*) as times
      from missing m
      join products p on p.id = m.product_id
      group by p.id, p.name
      order by units desc
    `.execute(this.db);
    return result.rows;
  }
}
