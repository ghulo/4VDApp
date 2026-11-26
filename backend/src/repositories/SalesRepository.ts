import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { escapeLikePattern } from '../utils/databaseErrors.js';
import type { RecordSource } from '../validators/validate.js';

export interface SaleFilters {
  startDate?: Date;
  endDate?: Date;
  productId?: number;
  soldBy?: number;
  /** Checkouts only: a product name, invoice number or imported receipt number. */
  search?: string;
  /** trefin: imported from the old till (they carry its receipt number); 4vd: rung up here. */
  source?: RecordSource;
  /** Checkouts only: by time (newest is the default) or by the checkout's total. */
  sort?: CheckoutSort;
  limit: number;
  offset: number;
}

export type CheckoutSort = 'newest' | 'oldest' | 'biggest' | 'smallest';

// Fixed SQL for each order (never built from the request), ties broken by the newest sale.
const CHECKOUT_ORDER: Record<CheckoutSort, string> = {
  newest: 'max(sale_date) desc, max(id) desc',
  oldest: 'min(sale_date) asc, min(id) asc',
  biggest: 'sum(total_amount) desc, max(sale_date) desc, max(id) desc',
  smallest: 'sum(total_amount) asc, max(sale_date) desc, max(id) desc',
};

export interface CheckoutDayTotal {
  day: string;
  checkouts: number;
  revenue: number;
}

export interface SaleRecord {
  id: number;
  product_id: number;
  product_name: string;
  quantity_sold: number;
  price_per_unit: string;
  discount_percent: string | null;
  /** Sold at a short-dated price: that much off the shelf price. */
  short_dated_percent: string | null;
  total_amount: string;
  sold_by_name: string | null;
  sale_date: Date;
  notes: string | null;
  /** The old till's receipt number, on sales imported from it. */
  receipt_no: string | null;
  wholesale: boolean;
  /** Units returned or waiting for a return decision. */
  returned_quantity: string;
  invoice_id: number | null;
  invoice_number: string | null;
}

const returnedQuantity = sql<string>`(
  select coalesce(sum(r.quantity), 0) from returns r where r.sale_id = s.id and r.status in ('pending', 'approved') and r.undone_at is null
)`.as('returned_quantity');

/** The newest invoice the sale is on (a restored sale is invoiced again). */
const lastInvoice = sql<{ id: number; number: string } | null>`(
  select json_build_object('id', d.id, 'number', d.number) from document_lines dl
  join documents d on d.id = dl.document_id
  where dl.sale_id = s.id and d.kind = 'invoice'
  order by d.id desc limit 1
)`;
const invoiceId = sql<number | null>`(${lastInvoice} ->> 'id')::int`.as('invoice_id');
const invoiceNumber = sql<string | null>`${lastInvoice} ->> 'number'`.as('invoice_number');

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
      .leftJoin('users as u', 'u.id', 's.sold_by')
      // An undone sale never happened, as far as history and totals go.
      .where('s.undone_at', 'is', null);
    if (filters.startDate) query = query.where('s.sale_date', '>=', filters.startDate);
    if (filters.endDate) query = query.where('s.sale_date', '<', filters.endDate);
    if (filters.productId) query = query.where('s.product_id', '=', filters.productId);
    if (filters.soldBy) query = query.where('s.sold_by', '=', filters.soldBy);
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
          's.discount_percent',
          's.short_dated_percent',
          's.total_amount',
          'u.name as sold_by_name',
          's.sale_date',
          's.notes',
          's.receipt_no',
          's.wholesale',
          returnedQuantity,
          invoiceId,
          invoiceNumber,
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

  /**
   * Sales grouped by checkout: everything on one invoice is one checkout, and
   * so is everything on one receipt imported from the old till (its numbers
   * restarted, so the receipt and its day together); an older sale with
   * neither stands alone. Paged by checkout, newest
   * first, with the lines of each checkout on the page.
   */
  /**
   * One page of checkouts, newest first, plus the whole filtered range's count
   * and revenue, and the totals of each shop day (in `timeZone`) the page shows.
   */
  async findCheckouts(
    filters: SaleFilters,
    timeZone: string,
  ): Promise<{ sales: SaleRecord[]; keys: string[]; total: number; revenue: number; days: CheckoutDayTotal[] }> {
    const pattern = filters.search ? `%${escapeLikePattern(filters.search)}%` : null;
    const conditions = [
      pattern
        ? sql`(exists (select 1 from products p where p.id = s.product_id and p.name ilike ${pattern}) or exists (select 1 from documents d where d.id = inv.id and d.number ilike ${pattern}) or s.receipt_no ilike ${pattern})`
        : sql`true`,
      filters.startDate ? sql`s.sale_date >= ${filters.startDate}` : sql`true`,
      filters.endDate ? sql`s.sale_date < ${filters.endDate}` : sql`true`,
      filters.productId ? sql`s.product_id = ${filters.productId}` : sql`true`,
      filters.soldBy ? sql`s.sold_by = ${filters.soldBy}` : sql`true`,
      filters.source ? (filters.source === 'trefin' ? sql`s.receipt_no is not null` : sql`s.receipt_no is null`) : sql`true`,
      sql`s.undone_at is null`,
    ];
    // The newest invoice of each sale. When the sales are narrowed (a date range, one product): through its index,
    // one sale at a time. Over the whole history: all invoice lines grouped once, cheaper than looking up 100k+ sales one by one.
    const narrowed = Boolean(filters.startDate || filters.productId);
    const newestInvoice = narrowed
      ? sql`left join lateral (
          select max(dl.document_id) as id from document_lines dl join documents d on d.id = dl.document_id
          where dl.sale_id = s.id and d.kind = 'invoice'
        ) inv on true`
      : sql`left join (
          select dl.sale_id, max(dl.document_id) as id from document_lines dl join documents d on d.id = dl.document_id
          where d.kind = 'invoice' and dl.sale_id is not null
          group by dl.sale_id
        ) inv on inv.sale_id = s.id`;
    const order = sql.raw(CHECKOUT_ORDER[filters.sort ?? 'newest']);
    // Each sale with its checkout's key, worked out once for the page, the totals, the day totals and the page's sales.
    const { rows } = await sql<{ keys: string[]; total: string; revenue: string; days: Array<{ day: string; checkouts: number; revenue: string | number }>; ids: number[] }>`
      with k as materialized (
        select s.id, s.sale_date, s.total_amount, coalesce('i' || inv.id, 'r' || s.receipt_no || '@' || (s.sale_date at time zone ${timeZone})::date::text, 's' || s.id) as key,
          (s.sale_date at time zone ${timeZone})::date::text as day
        from sales s
        ${newestInvoice}
        where ${sql.join(conditions, sql` and `)}
      ),
      page as (
        select key, row_number() over (order by ${order}) as n from k
        group by key order by ${order}
        limit ${filters.limit} offset ${filters.offset}
      )
      select
        (select coalesce(json_agg(key order by n), '[]') from page) as keys,
        (select count(distinct key) from k) as total,
        (select coalesce(sum(total_amount), 0) from k) as revenue,
        (select coalesce(json_agg(json_build_object('day', day, 'checkouts', checkouts, 'revenue', revenue)), '[]') from (
          select day, count(distinct key) as checkouts, sum(total_amount) as revenue from k
          where day in (select k.day from k join page on page.key = k.key)
          group by day
        ) d) as days,
        (select coalesce(json_agg(k.id), '[]') from k join page on page.key = k.key) as ids
    `.execute(this.db);
    const found = rows[0]!;
    const keys = found.keys;
    const days = found.days.map((row) => ({ day: row.day, checkouts: Number(row.checkouts), revenue: Number(row.revenue) }));
    const ids = found.ids;
    const sales =
      ids.length === 0
        ? []
        : await this.filteredQuery({})
            .select([
              's.id',
              's.product_id',
              'p.name as product_name',
              's.quantity_sold',
              's.price_per_unit',
              's.discount_percent',
          's.short_dated_percent',
              's.total_amount',
              'u.name as sold_by_name',
              's.sale_date',
              's.notes',
              's.receipt_no',
              's.wholesale',
              returnedQuantity,
              invoiceId,
              invoiceNumber,
            ])
            .where('s.id', 'in', ids)
            .orderBy('s.id')
            .execute();
    return { sales, keys, total: Number(found.total), revenue: Number(found.revenue), days };
  }

  async create(sale: {
    productId: number;
    quantity: number;
    pricePerUnit: number;
    unitCost: number | null;
    soldBy: number;
    promotionId: number | null;
    discountPercent?: number | null;
    priceBeforeDiscount?: number | null;
    notes: string | null;
    saleDate?: Date;
    wholesale?: boolean;
    expiryDateId?: number | null;
    shortDatedPercent?: number | null;
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
        discount_percent: sale.discountPercent ?? null,
        price_before_discount: sale.priceBeforeDiscount ?? null,
        wholesale: sale.wholesale ?? false,
        expiry_date_id: sale.expiryDateId ?? null,
        short_dated_percent: sale.shortDatedPercent ?? null,
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
        's.discount_percent',
          's.short_dated_percent',
        's.total_amount',
        'u.name as sold_by_name',
        's.sale_date',
        's.notes',
        's.receipt_no',
        's.wholesale',
        returnedQuantity,
        invoiceId,
        invoiceNumber,
      ])
      .where('s.id', '=', id)
      .executeTakeFirst();
  }

  /** Several sales in one query, in the order of `ids`; one that doesn't exist (or was undone) is left out. */
  async findByIds(ids: number[]): Promise<SaleRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.filteredQuery({})
      .select([
        's.id',
        's.product_id',
        'p.name as product_name',
        's.quantity_sold',
        's.price_per_unit',
        's.discount_percent',
        's.short_dated_percent',
        's.total_amount',
        'u.name as sold_by_name',
        's.sale_date',
        's.notes',
        's.receipt_no',
        's.wholesale',
        returnedQuantity,
        invoiceId,
        invoiceNumber,
      ])
      .where('s.id', 'in', ids)
      .execute();
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => byId.get(id) ?? []);
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
   * charts don't silently skip quiet days. Buckets are the shop's own days,
   * weeks or months in `timeZone`, like the reports.
   */
  async revenueByPeriod(period: RevenuePeriod, range: DateRange, timeZone: string, productId?: number) {
    const unit = { daily: 'day', weekly: 'week', monthly: 'month' }[period];
    const step = { daily: '1 day', weekly: '1 week', monthly: '1 month' }[period];
    const productFilter = productId ? sql`and l.product_id = ${productId}` : sql``;

    const result = await sql<{ period_start: string; revenue: string; profit: string; units_sold: string; sales_count: string }>`
      with buckets as (
        select generate_series(
          date_trunc(${unit}, ${range.startDate}::timestamptz at time zone ${timeZone}),
          date_trunc(${unit}, (${range.endDate}::timestamptz - interval '1 microsecond') at time zone ${timeZone}),
          ${step}::interval
        ) as period_start
      )
      select
        to_char(b.period_start, 'YYYY-MM-DD') as period_start,
        coalesce(sum(l.revenue), 0) as revenue,
        -- Same rule as the reports' profit: only lines with a known cost count.
        coalesce(sum(l.revenue - l.cost) filter (where l.unit_cost is not null), 0) as profit,
        coalesce(sum(l.units), 0) as units_sold,
        count(l.sale_id) filter (where l.return_id is null) as sales_count
      from buckets b
      left join sales_ledger l
        on date_trunc(${unit}, l.occurred_at at time zone ${timeZone}) = b.period_start
        and l.occurred_at >= ${range.startDate}
        and l.occurred_at < ${range.endDate}
        ${productFilter}
      group by b.period_start
      order by b.period_start
    `.execute(this.db);

    return result.rows.map((row) => ({
      periodStart: row.period_start,
      revenue: Number(row.revenue),
      profit: Number(row.profit),
      unitsSold: Number(row.units_sold),
      salesCount: Number(row.sales_count),
    }));
  }
}
