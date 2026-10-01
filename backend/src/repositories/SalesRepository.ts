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
    soldBy: number;
    notes: string | null;
    saleDate?: Date;
  }): Promise<number> {
    const row = await this.db
      .insertInto('sales')
      .values({
        product_id: sale.productId,
        quantity_sold: sale.quantity,
        price_per_unit: sale.pricePerUnit,
        sold_by: sale.soldBy,
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
      ])
      .where('s.id', '=', id)
      .executeTakeFirst();
  }

  async totals(range?: DateRange): Promise<{ salesCount: number; unitsSold: number; revenue: number; profit: number }> {
    const row = await this.filteredQuery(range ?? {})
      .select([
        sql<string>`count(*)`.as('sales_count'),
        sql<string>`coalesce(sum(s.quantity_sold), 0)`.as('units_sold'),
        sql<string>`coalesce(sum(s.total_amount), 0)`.as('revenue'),
        // Profit only counts products whose cost price is known.
        sql<string>`coalesce(sum(s.quantity_sold * (s.price_per_unit - p.cost_price)) filter (where p.cost_price is not null), 0)`.as(
          'profit',
        ),
      ])
      .executeTakeFirstOrThrow();
    return {
      salesCount: Number(row.sales_count),
      unitsSold: Number(row.units_sold),
      revenue: Number(row.revenue),
      profit: Number(row.profit),
    };
  }

  async topProducts(range: DateRange | undefined, limit: number) {
    const rows = await this.filteredQuery(range ?? {})
      .select([
        's.product_id',
        'p.name as product_name',
        sql<string>`sum(s.quantity_sold)`.as('units_sold'),
        sql<string>`sum(s.total_amount)`.as('revenue'),
      ])
      .groupBy(['s.product_id', 'p.name'])
      .orderBy(sql`sum(s.total_amount)`, 'desc')
      .limit(limit)
      .execute();
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
    const productFilter = productId ? sql`and s.product_id = ${productId}` : sql``;

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
        coalesce(sum(s.total_amount), 0) as revenue,
        coalesce(sum(s.quantity_sold), 0) as units_sold,
        count(s.id) as sales_count
      from buckets b
      left join sales s
        on date_trunc(${unit}, s.sale_date at time zone 'UTC') = b.period_start
        and s.sale_date >= ${range.startDate}
        and s.sale_date < ${range.endDate}
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
