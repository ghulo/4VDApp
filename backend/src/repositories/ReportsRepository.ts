import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { DateRange } from '../services/reports/calculations.js';

export interface TotalsRow {
  sales_count: string;
  units_sold: string;
  revenue: string;
  refunds: string;
  revenue_without_cost: string;
  cost: string;
  profit: string;
}

export interface TeamQueryRow {
  user_id: number;
  name: string;
  role: string;
  has_left: boolean;
  monthly_target: string | null;
  commission_percent: string | null;
  sales_count: string;
  units_sold: string;
  revenue: string;
  refunds: string;
  profit: string;
}

export interface StockLossRow {
  stock_losses: string;
  loss_units_without_cost: string;
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
  price_per_unit: string;
  total_amount: string;
  sale_date: Date;
  returned_quantity: string;
}

/** A sale, or an approved return as a negative row on the day it was approved. */
export interface SaleExportRow {
  kind: 'Sale' | 'Return';
  occurred_at: Date;
  product_name: string;
  sku: string | null;
  quantity: number;
  unit_price: string;
  total: string;
  unit_cost: string | null;
  sold_by_name: string | null;
  notes: string | null;
}

/** All report SQL in one place. Read-only. Ranges are start-inclusive, end-exclusive. */
export class ReportsRepository {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Money for the period from `sales_ledger`: sales on their sale date and
   * approved refunds (negative) on the day they were approved.
   */
  async totals(range: DateRange, soldBy?: number): Promise<TotalsRow> {
    const sellerFilter = soldBy === undefined ? sql`` : sql`and l.sold_by = ${soldBy}`;
    const result = await sql<TotalsRow>`
      select
        count(*) filter (where l.return_id is null) as sales_count,
        coalesce(sum(l.units), 0) as units_sold,
        coalesce(sum(l.revenue), 0) as revenue,
        coalesce(-sum(l.revenue) filter (where l.return_id is not null), 0) as refunds,
        coalesce(sum(l.revenue) filter (where l.unit_cost is null), 0) as revenue_without_cost,
        coalesce(sum(l.cost) filter (where l.unit_cost is not null), 0) as cost,
        coalesce(sum(l.revenue - l.cost) filter (where l.unit_cost is not null), 0) as profit
      from sales_ledger l
      where l.occurred_at >= ${range.startDate} and l.occurred_at < ${range.endDate} ${sellerFilter}
    `.execute(this.db);
    return result.rows[0]!;
  }

  /**
   * Stock lost in the period, valued at cost: approved write-offs plus
   * approved count differences (a surplus counts against the losses).
   */
  async stockLosses(range: DateRange): Promise<StockLossRow> {
    const result = await sql<StockLossRow>`
      with losses as (
        select w.quantity as units, w.unit_cost
        from write_offs w
        where w.status = 'approved' and w.decided_at >= ${range.startDate} and w.decided_at < ${range.endDate}
        union all
        select l.expected_quantity - l.counted_quantity, l.unit_cost
        from stock_count_lines l
        where l.status = 'approved' and l.decided_at >= ${range.startDate} and l.decided_at < ${range.endDate}
      )
      select
        coalesce(sum(units * unit_cost) filter (where unit_cost is not null), 0) as stock_losses,
        coalesce(sum(abs(units)) filter (where unit_cost is null), 0) as loss_units_without_cost
      from losses
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
        u.monthly_target,
        u.commission_percent,
        count(l.sale_id) filter (where l.return_id is null) as sales_count,
        coalesce(sum(l.units), 0) as units_sold,
        coalesce(sum(l.revenue), 0) as revenue,
        coalesce(-sum(l.revenue) filter (where l.return_id is not null), 0) as refunds,
        coalesce(sum(l.revenue - l.cost) filter (where l.unit_cost is not null), 0) as profit
      from users u
      left join sales_ledger l
        on l.sold_by = u.id and l.occurred_at >= ${range.startDate} and l.occurred_at < ${range.endDate}
      where (u.role in ('admin', 'employee') and u.is_active and u.deleted_at is null) or l.sale_id is not null
      group by u.id
      order by revenue desc, u.name
    `.execute(this.db);
    return result.rows;
  }

  async monthlyTarget(userId: number): Promise<number | null> {
    const row = await this.db.selectFrom('users').select('monthly_target').where('id', '=', userId).executeTakeFirst();
    return row?.monthly_target == null ? null : Number(row.monthly_target);
  }

  async profitBy(range: DateRange, groupBy: 'product' | 'category'): Promise<ProfitQueryRow[]> {
    const group = groupBy === 'product' ? sql`p.id, p.name` : sql`c.id, c.name`;
    const result = await sql<ProfitQueryRow>`
      select
        ${group},
        sum(l.units) as units_sold,
        sum(l.revenue) as revenue,
        coalesce(sum(l.cost) filter (where l.unit_cost is not null), 0) as cost,
        coalesce(sum(l.revenue - l.cost) filter (where l.unit_cost is not null), 0) as profit,
        coalesce(sum(l.revenue) filter (where l.unit_cost is not null), 0) as revenue_with_cost,
        bool_or(l.unit_cost is null) as has_unknown_cost
      from sales_ledger l
      join products p on p.id = l.product_id
      join categories c on c.id = p.category_id
      where l.occurred_at >= ${range.startDate} and l.occurred_at < ${range.endDate}
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
      select s.id, p.name as product_name, s.quantity_sold, s.price_per_unit, s.total_amount, s.sale_date,
             (select coalesce(sum(r.quantity), 0) from returns r
              where r.sale_id = s.id and r.status in ('pending', 'approved')) as returned_quantity
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
      select kind, occurred_at, product_name, sku, quantity, unit_price, total, unit_cost, sold_by_name, notes
      from (
        select 'Sale' as kind, s.sale_date as occurred_at, p.name as product_name, p.sku, s.quantity_sold as quantity,
               s.price_per_unit as unit_price, s.total_amount as total, s.unit_cost, u.name as sold_by_name, s.notes,
               s.id as row_id
        from sales s
        join products p on p.id = s.product_id
        left join users u on u.id = s.sold_by
        where s.sale_date >= ${range.startDate} and s.sale_date < ${range.endDate}
        union all
        select 'Return', r.decided_at, p.name, p.sku, -r.quantity,
               round(r.refund_amount / r.quantity, 2), -r.refund_amount, s.unit_cost, u.name, r.notes,
               r.id
        from returns r
        join sales s on s.id = r.sale_id
        join products p on p.id = s.product_id
        left join users u on u.id = s.sold_by
        where r.status = 'approved' and r.decided_at >= ${range.startDate} and r.decided_at < ${range.endDate}
      ) rows
      order by occurred_at, kind desc, row_id
    `.execute(this.db);
    return result.rows;
  }

}
