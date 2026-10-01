import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { DateRange } from '../services/reports/calculations.js';

export interface TotalsRow {
  sales_count: string;
  units_sold: string;
  revenue: string;
  revenue_without_cost: string;
  cost: string;
  profit: string;
}

export interface TeamQueryRow {
  user_id: number;
  name: string;
  role: string;
  has_left: boolean;
  sales_count: string;
  units_sold: string;
  revenue: string;
  profit: string;
}

export interface ProfitQueryRow {
  id: number;
  name: string;
  units_sold: string;
  revenue: string;
  cost: string;
  profit: string;
  revenue_with_cost: string;
  has_unknown_cost: boolean;
}

export interface VelocityRow {
  product_id: number;
  product_name: string;
  sku: string | null;
  category_name: string;
  quantity_on_hand: number;
  reorder_level: number;
  base_price: string;
  cost_price: string | null;
  units_sold_recently: string;
}

export interface MySaleRow {
  id: number;
  product_name: string;
  quantity_sold: number;
  total_amount: string;
  sale_date: Date;
}

export interface SaleExportRow {
  sale_date: Date;
  product_name: string;
  sku: string | null;
  quantity_sold: number;
  price_per_unit: string;
  total_amount: string;
  unit_cost: string | null;
  sold_by_name: string | null;
  notes: string | null;
}

/** All report SQL in one place. Read-only. Ranges are start-inclusive, end-exclusive. */
export class ReportsRepository {
  constructor(private readonly db: DatabaseClient) {}

  async totals(range: DateRange, soldBy?: number): Promise<TotalsRow> {
    const sellerFilter = soldBy === undefined ? sql`` : sql`and s.sold_by = ${soldBy}`;
    const result = await sql<TotalsRow>`
      select
        count(*) as sales_count,
        coalesce(sum(s.quantity_sold), 0) as units_sold,
        coalesce(sum(s.total_amount), 0) as revenue,
        coalesce(sum(s.total_amount) filter (where s.unit_cost is null), 0) as revenue_without_cost,
        coalesce(sum(s.quantity_sold * s.unit_cost) filter (where s.unit_cost is not null), 0) as cost,
        coalesce(sum(s.quantity_sold * (s.price_per_unit - s.unit_cost)) filter (where s.unit_cost is not null), 0) as profit
      from sales s
      where s.sale_date >= ${range.startDate} and s.sale_date < ${range.endDate} ${sellerFilter}
    `.execute(this.db);
    return result.rows[0]!;
  }

  /**
   * Every active admin/employee (so people with no sales show as zero), plus
   * anyone who sold in the period even if they were removed since.
   */
  async team(range: DateRange): Promise<TeamQueryRow[]> {
    const result = await sql<TeamQueryRow>`
      select
        u.id as user_id,
        u.name,
        u.role,
        (not u.is_active or u.deleted_at is not null) as has_left,
        count(s.id) as sales_count,
        coalesce(sum(s.quantity_sold), 0) as units_sold,
        coalesce(sum(s.total_amount), 0) as revenue,
        coalesce(sum(s.quantity_sold * (s.price_per_unit - s.unit_cost)) filter (where s.unit_cost is not null), 0) as profit
      from users u
      left join sales s
        on s.sold_by = u.id and s.sale_date >= ${range.startDate} and s.sale_date < ${range.endDate}
      where (u.role in ('admin', 'employee') and u.is_active and u.deleted_at is null) or s.id is not null
      group by u.id, u.name, u.role, u.is_active, u.deleted_at
      order by revenue desc, u.name
    `.execute(this.db);
    return result.rows;
  }

  async profitBy(range: DateRange, groupBy: 'product' | 'category'): Promise<ProfitQueryRow[]> {
    const group = groupBy === 'product' ? sql`p.id, p.name` : sql`c.id, c.name`;
    const result = await sql<ProfitQueryRow>`
      select
        ${group},
        sum(s.quantity_sold) as units_sold,
        sum(s.total_amount) as revenue,
        coalesce(sum(s.quantity_sold * s.unit_cost) filter (where s.unit_cost is not null), 0) as cost,
        coalesce(sum(s.quantity_sold * (s.price_per_unit - s.unit_cost)) filter (where s.unit_cost is not null), 0) as profit,
        coalesce(sum(s.total_amount) filter (where s.unit_cost is not null), 0) as revenue_with_cost,
        bool_or(s.unit_cost is null) as has_unknown_cost
      from sales s
      join products p on p.id = s.product_id
      join categories c on c.id = p.category_id
      where s.sale_date >= ${range.startDate} and s.sale_date < ${range.endDate}
      group by ${group}
      order by profit desc, revenue desc
    `.execute(this.db);
    return result.rows;
  }

  /** Active products with stock and how many sold since `since`. */
  /** Pass `since: null` when only the stock columns are needed, to skip counting sales. */
  async salesVelocity(since: Date | null): Promise<VelocityRow[]> {
    const unitsSold =
      since === null
        ? sql`0`
        : sql`coalesce((select sum(s.quantity_sold) from sales s where s.product_id = p.id and s.sale_date >= ${since}), 0)`;
    const result = await sql<VelocityRow>`
      select
        p.id as product_id,
        p.name as product_name,
        p.sku,
        c.name as category_name,
        i.quantity_on_hand,
        i.reorder_level,
        p.base_price,
        p.cost_price,
        ${unitsSold} as units_sold_recently
      from products p
      join inventory i on i.product_id = p.id
      join categories c on c.id = p.category_id
      where p.deleted_at is null and p.is_active
      order by p.name
    `.execute(this.db);
    return result.rows;
  }

  async recentSalesBy(soldBy: number, range: DateRange, limit: number): Promise<MySaleRow[]> {
    const result = await sql<MySaleRow>`
      select s.id, p.name as product_name, s.quantity_sold, s.total_amount, s.sale_date
      from sales s
      join products p on p.id = s.product_id
      where s.sold_by = ${soldBy} and s.sale_date >= ${range.startDate} and s.sale_date < ${range.endDate}
      order by s.sale_date desc, s.id desc
      limit ${limit}
    `.execute(this.db);
    return result.rows;
  }

  async salesForExport(range: DateRange): Promise<SaleExportRow[]> {
    const result = await sql<SaleExportRow>`
      select s.sale_date, p.name as product_name, p.sku, s.quantity_sold, s.price_per_unit, s.total_amount,
             s.unit_cost, u.name as sold_by_name, s.notes
      from sales s
      join products p on p.id = s.product_id
      left join users u on u.id = s.sold_by
      where s.sale_date >= ${range.startDate} and s.sale_date < ${range.endDate}
      order by s.sale_date, s.id
    `.execute(this.db);
    return result.rows;
  }
}
