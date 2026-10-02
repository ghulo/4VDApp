import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export interface SaleFilters {
  startDate?: Date;
  endDate?: Date;
  productId?: number;
  limit: number;
  offset: number;
}

export interface SaleRecord {
  id: number;
  product_id: number;
  product_name: string;
  quantity_sold: number;
  price_per_unit: string;
  total_amount: string;
  sold_by_name: string | null;
  sale_date: Date;
  notes: string | null;
  /** Units returned or waiting for a return decision. */
  returned_quantity: string;
}

const returnedQuantity = sql<string>`(
  select coalesce(sum(r.quantity), 0) from returns r where r.sale_id = s.id and r.status in ('pending', 'approved')
)`.as('returned_quantity');

function ledgerRange(range?: DateRange) {
  return range ? sql`l.occurred_at >= ${range.startDate} and l.occurred_at < ${range.endDate}` : sql`true`;
}

export type RevenuePeriod = 'daily' | 'weekly' | 'monthly';

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export class SalesRepository {
  constructor(private readonly db: DatabaseClient) {}

  private filteredQuery(filters: Omit<SaleFilters, 'limit' | 'offset'>) {
    let query = this.db
      .selectFrom('sales as s')
      .innerJoin('products as p', 'p.id', 's.product_id')
      .leftJoin('users as u', 'u.id', 's.sold_by');
    if (filters.startDate) query = query.where('s.sale_date', '>=', filters.startDate);
    if (filters.endDate) query = query.where('s.sale_date', '<', filters.endDate);
    if (filters.productId) query = query.where('s.product_id', '=', filters.productId);
    return query;
  }

  async findMany(filters: SaleFilters): Promise<{ sales: SaleRecord[]; total: number; revenue: number }> {
    const query = this.filteredQuery(filters);
    const [sales, summary] = await Promise.all([
      query
        .select([
          's.id',
          's.product_id',
          'p.name as product_name',
          's.quantity_sold',
          's.price_per_unit',
          's.total_amount',
          'u.name as sold_by_name',
          's.sale_date',
          's.notes',
          returnedQuantity,
        ])
        .orderBy('s.sale_date', 'desc')
        .orderBy('s.id', 'desc')
        .limit(filters.limit)
        .offset(filters.offset)
        .execute(),
      query
        .select((eb) => [
          eb.fn.countAll<string>().as('total'),
          sql<string>`coalesce(sum(s.total_amount), 0)`.as('revenue'),
        ])
        .executeTakeFirstOrThrow(),
    ]);
    return { sales, total: Number(summary.total), revenue: Number(summary.revenue) };
  }

  async create(sale: {
    productId: number;
    quantity: number;
    pricePerUnit: number;
    unitCost: number | null;
    soldBy: number;
    promotionId: number | null;
    notes: string | null;
    saleDate?: Date;
  }): Promise<number> {
    const row = await this.db
      .insertInto('sales')
      .values({
        product_id: sale.productId,
        quantity_sold: sale.quantity,
        price_per_unit: sale.pricePerUnit,
        unit_cost: sale.unitCost,
        sold_by: sale.soldBy,
        promotion_id: sale.promotionId,
        notes: sale.notes,
        ...(sale.saleDate && { sale_date: sale.saleDate }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async findById(id: number): Promise<SaleRecord | undefined> {
    return this.filteredQuery({})
      .select([
        's.id',
        's.product_id',
        'p.name as product_name',
        's.quantity_sold',
        's.price_per_unit',
        's.total_amount',
        'u.name as sold_by_name',
        's.sale_date',
        's.notes',
        returnedQuantity,
      ])
      .where('s.id', '=', id)
      .executeTakeFirst();
  }

  /** Dashboard totals from `sales_ledger`, so refunds count the same way as in reports. */
  async totals(range?: DateRange): Promise<{ salesCount: number; unitsSold: number; revenue: number; profit: number }> {
    const result = await sql<{ sales_count: string; units_sold: string; revenue: string; profit: string }>`
      select
        count(*) filter (where l.return_id is null) as sales_count,
        coalesce(sum(l.units), 0) as units_sold,
        coalesce(sum(l.revenue), 0) as revenue,
        -- Profit only counts sales whose cost was known when they were made.
        coalesce(sum(l.revenue - l.cost) filter (where l.unit_cost is not null), 0) as profit
      from sales_ledger l
      where ${ledgerRange(range)}
    `.execute(this.db);
    const row = result.rows[0]!;
    return {
      salesCount: Number(row.sales_count),
      unitsSold: Number(row.units_sold),
      revenue: Number(row.revenue),
      profit: Number(row.profit),
    };
  }

  async topProducts(range: DateRange | undefined, limit: number) {
    const result = await sql<{ product_id: number; product_name: string; units_sold: string; revenue: string }>`
      select l.product_id, p.name as product_name, sum(l.units) as units_sold, sum(l.revenue) as revenue
      from sales_ledger l
      join products p on p.id = l.product_id
      where ${ledgerRange(range)}
      group by l.product_id, p.name
      order by sum(l.revenue) desc
      limit ${limit}
    `.execute(this.db);
    const rows = result.rows;
    return rows.map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      unitsSold: Number(row.units_sold),
      revenue: Number(row.revenue),
    }));
  }

  /**
   * Revenue per day/week/month, including periods with no sales (as zero), so
   * charts don't silently skip quiet days. Buckets are in UTC.
   */
  async revenueByPeriod(period: RevenuePeriod, range: DateRange, productId?: number) {
    const unit = { daily: 'day', weekly: 'week', monthly: 'month' }[period];
    const step = { daily: '1 day', weekly: '1 week', monthly: '1 month' }[period];
    const productFilter = productId ? sql`and l.product_id = ${productId}` : sql``;

    const result = await sql<{ period_start: string; revenue: string; units_sold: string; sales_count: string }>`
      with buckets as (
        select generate_series(
          date_trunc(${unit}, ${range.startDate}::timestamptz at time zone 'UTC'),
          date_trunc(${unit}, (${range.endDate}::timestamptz - interval '1 microsecond') at time zone 'UTC'),
          ${step}::interval
        ) as period_start
      )
      select
        to_char(b.period_start, 'YYYY-MM-DD') as period_start,
        coalesce(sum(l.revenue), 0) as revenue,
        coalesce(sum(l.units), 0) as units_sold,
        count(l.sale_id) filter (where l.return_id is null) as sales_count
      from buckets b
      left join sales_ledger l
        on date_trunc(${unit}, l.occurred_at at time zone 'UTC') = b.period_start
        and l.occurred_at >= ${range.startDate}
        and l.occurred_at < ${range.endDate}
        ${productFilter}
      group by b.period_start
      order by b.period_start
    `.execute(this.db);

    return result.rows.map((row) => ({
      periodStart: row.period_start,
      revenue: Number(row.revenue),
      unitsSold: Number(row.units_sold),
      salesCount: Number(row.sales_count),
    }));
  }
}
