import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { CounterEventKind } from '../database/types.js';

export interface NewCounterEvent {
  kind: CounterEventKind;
  userId: number;
  productId?: number | null;
  quantity?: number | null;
  amount?: number | null;
  reason?: string | null;
  documentId?: number | null;
}

export interface CounterPersonRow {
  user_id: number;
  name: string;
  sales: number;
  sold: string;
  cash: string;
  card: string;
  tab: string;
  lines_removed: number;
  removed_amount: string;
  baskets_cancelled: number;
  cancelled_amount: string;
  refunds: number;
  refunded: string;
  drawer_opens: number;
  print_failures: number;
  reprints: number;
}

export interface CounterEventRow {
  id: number;
  kind: CounterEventKind;
  user_id: number | null;
  user_name: string | null;
  product_id: number | null;
  product_name: string | null;
  quantity: number | null;
  amount: string | null;
  reason: string | null;
  document_id: number | null;
  document_number: string | null;
  created_at: Date;
}

const inDays = (column: ReturnType<typeof sql.ref>, from: string, to: string, timeZone: string) =>
  sql<boolean>`(${column} at time zone ${timeZone})::date between ${from}::date and ${to}::date`;

export class CounterRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(events: NewCounterEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.db
      .insertInto('counter_events')
      .values(
        events.map((event) => ({
          kind: event.kind,
          user_id: event.userId,
          product_id: event.productId ?? null,
          quantity: event.quantity ?? null,
          amount: event.amount ?? null,
          reason: event.reason ?? null,
          document_id: event.documentId ?? null,
        })),
      )
      .execute();
  }

  /** The last time each of the printer's reports ran, with who ran it. */
  /** The number the next invoice of this year will get, without taking it (the counter shows it before paying). */
  async nextInvoiceNumber(year: number): Promise<number> {
    const row = await this.db
      .selectFrom('document_numbers')
      .select('last_number')
      .where('kind', '=', 'invoice')
      .where('year', '=', year)
      .executeTakeFirst();
    return (row?.last_number ?? 0) + 1;
  }

  async lastReport(kind: 'x_report' | 'z_report'): Promise<{ created_at: Date; user_name: string | null } | undefined> {
    return this.db
      .selectFrom('counter_events as e')
      .leftJoin('users as u', 'u.id', 'e.user_id')
      .select(['e.created_at', 'u.name as user_name'])
      .where('e.kind', '=', kind)
      .orderBy('e.created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * One row per person who sold, removed, cancelled, refunded or opened the
   * drawer between two shop days: their checkouts (by how they were paid) and
   * everything else that happened at the counter.
   */
  async people(from: string, to: string, timeZone: string): Promise<CounterPersonRow[]> {
    const { rows } = await sql<CounterPersonRow>`
      with sold as (
        select d.issued_by as user_id, count(*)::int as sales, sum(d.total) as sold,
          -- A split payment counts its card part as card and the rest as cash.
          coalesce(sum(d.total - coalesce(d.card_amount, 0)) filter (where d.payment_method = 'till'), 0) as cash,
          coalesce(sum(case when d.payment_method = 'card' then d.total else coalesce(d.card_amount, 0) end) filter (where d.payment_method in ('card', 'till')), 0) as card,
          coalesce(sum(d.total) filter (where d.payment_method = 'account'), 0) as tab
        from documents d
        where d.kind = 'invoice' and d.issued_by is not null and ${inDays(sql.ref('d.issued_at'), from, to, timeZone)}
          -- An invoice whose every sale was undone was taken back.
          and exists (select 1 from document_lines l join sales s on s.id = l.sale_id where l.document_id = d.id and s.undone_at is null)
        group by d.issued_by
      ),
      events as (
        select e.user_id,
          count(*) filter (where e.kind = 'line_removed')::int as lines_removed,
          coalesce(sum(e.amount) filter (where e.kind = 'line_removed'), 0) as removed_amount,
          count(*) filter (where e.kind = 'basket_cancelled')::int as baskets_cancelled,
          coalesce(sum(e.amount) filter (where e.kind = 'basket_cancelled'), 0) as cancelled_amount,
          count(*) filter (where e.kind = 'drawer_opened')::int as drawer_opens,
          count(*) filter (where e.kind = 'print_failed')::int as print_failures,
          count(*) filter (where e.kind = 'reprinted')::int as reprints
        from counter_events e
        where e.user_id is not null and ${inDays(sql.ref('e.created_at'), from, to, timeZone)}
        group by e.user_id
      ),
      refunds as (
        select r.requested_by as user_id, count(*)::int as refunds, sum(r.refund_amount) as refunded
        from returns r
        where r.requested_by is not null and r.status <> 'rejected' and r.undone_at is null
          and ${inDays(sql.ref('r.requested_at'), from, to, timeZone)}
        group by r.requested_by
      ),
      people as (select user_id from sold union select user_id from events union select user_id from refunds)
      select p.user_id, u.name,
        coalesce(s.sales, 0) as sales, coalesce(s.sold, 0) as sold, coalesce(s.cash, 0) as cash, coalesce(s.card, 0) as card, coalesce(s.tab, 0) as tab,
        coalesce(e.lines_removed, 0) as lines_removed, coalesce(e.removed_amount, 0) as removed_amount,
        coalesce(e.baskets_cancelled, 0) as baskets_cancelled, coalesce(e.cancelled_amount, 0) as cancelled_amount,
        coalesce(r.refunds, 0) as refunds, coalesce(r.refunded, 0) as refunded,
        coalesce(e.drawer_opens, 0) as drawer_opens, coalesce(e.print_failures, 0) as print_failures, coalesce(e.reprints, 0) as reprints
      from people p
      join users u on u.id = p.user_id
      left join sold s on s.user_id = p.user_id
      left join events e on e.user_id = p.user_id
      left join refunds r on r.user_id = p.user_id
      order by coalesce(s.sold, 0) desc, u.name
    `.execute(this.db);
    return rows;
  }

  /** Every counter event between two shop days, newest first; one person's when `userId` is given. */
  async events(from: string, to: string, timeZone: string, userId?: number): Promise<CounterEventRow[]> {
    let query = this.db
      .selectFrom('counter_events as e')
      .leftJoin('users as u', 'u.id', 'e.user_id')
      .leftJoin('products as p', 'p.id', 'e.product_id')
      .leftJoin('documents as d', 'd.id', 'e.document_id')
      .select([
        'e.id',
        'e.kind',
        'e.user_id',
        'u.name as user_name',
        'e.product_id',
        'p.name as product_name',
        'e.quantity',
        'e.amount',
        'e.reason',
        'e.document_id',
        'd.number as document_number',
        'e.created_at',
      ])
      .where(inDays(sql.ref('e.created_at'), from, to, timeZone))
      .orderBy('e.created_at', 'desc')
      .orderBy('e.id', 'desc')
      .limit(500);
    if (userId !== undefined) query = query.where('e.user_id', '=', userId);
    return query.execute();
  }

  /** Receipts deleted in TREFIN in these days, newest first. */
  trefinDeletions(from: string, to: string, timeZone: string) {
    return this.db
      .selectFrom('trefin_deleted_receipts')
      .select(['id', 'number', 'kind', sql<string>`to_char(sold_on, 'YYYY-MM-DD')`.as('sold_on'), 'deleted_at', 'deleted_by', 'customer', 'total', 'lines'])
      .where(inDays(sql.ref('deleted_at'), from, to, timeZone))
      .orderBy('deleted_at', 'desc')
      .limit(500)
      .execute();
  }

  /** Invoices with their lines, newest first: one day's, or the one with this number. */
  async receipts(p: { number?: string; day?: string; timeZone: string }): Promise<{ receipts: CounterReceiptRow[]; lines: CounterReceiptLineRow[] }> {
    let query = this.db
      .selectFrom('documents as d')
      .leftJoin('users as u', 'u.id', 'd.issued_by')
      .select(['d.id', 'd.number', 'd.issued_at', 'd.total', 'd.payment_method', 'd.card_amount', 'd.fiscal_receipt_no', 'u.name as issued_by_name'])
      .where('d.kind', '=', 'invoice')
      // Nothing is given back from TREFIN's invoices here.
      .where('d.trefin_ref', 'is', null)
      .orderBy('d.issued_at', 'desc')
      .limit(60);
    if (p.number !== undefined) query = query.where(sql<boolean>`upper(d.number) = upper(${p.number})`);
    if (p.day !== undefined) query = query.where(sql<boolean>`(d.issued_at at time zone ${p.timeZone})::date = ${p.day}::date`);
    const receipts = await query.execute();
    if (receipts.length === 0) return { receipts, lines: [] };
    const { rows: lines } = await sql<CounterReceiptLineRow>`
      select l.document_id, s.id as sale_id, s.product_id, l.product_name, s.quantity_sold as quantity, s.price_per_unit, s.sale_date,
        coalesce((select sum(r.quantity) from returns r where r.sale_id = s.id and r.status in ('pending', 'approved') and r.undone_at is null), 0)::int as returned_quantity,
        s.undone_at is not null as undone
      from document_lines l join sales s on s.id = l.sale_id
      where l.document_id in (${sql.join(receipts.map((receipt) => receipt.id))}) and l.return_id is null
      order by l.id
    `.execute(this.db);
    return { receipts, lines };
  }
}

export interface CounterReceiptRow {
  id: number;
  number: string;
  issued_at: Date;
  total: string;
  payment_method: string;
  card_amount: string | null;
  fiscal_receipt_no: string | null;
  issued_by_name: string | null;
}

export interface CounterReceiptLineRow {
  document_id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  price_per_unit: string;
  sale_date: Date;
  returned_quantity: number;
  undone: boolean;
}
