import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { TabEntryKind } from '../database/types.js';

/** What staff type in for a customer. */
export interface CustomerFields {
  name: string;
  kind: 'person' | 'business';
  nui: string | null;
  phone: string | null;
  note: string | null;
}

export interface CustomerRecord {
  id: number;
  name: string;
  kind: 'person' | 'business';
  nui: string | null;
  phone: string | null;
  note: string | null;
  archived_at: Date | null;
  created_at: Date;
}

export interface TabEntryRecord {
  id: number;
  customer_id: number;
  kind: TabEntryKind;
  amount: string;
  note: string | null;
  sale_id: number | null;
  /** True when the charge's sale (or the refund's return) was undone, so it no longer counts. */
  sale_undone: boolean;
  occurred_at: Date;
  created_by_name: string | null;
}

export interface PurchaseTotals {
  spent: number;
  spentThisYear: number;
  purchases: number;
  lastPurchaseAt: Date | null;
}

/** Charges on undone sales and refunds of undone returns don't count; everything else does. */
const counts = sql<boolean>`((e.sale_id is null or s.undone_at is null) and (e.return_id is null or r.undone_at is null))`;

export class TabRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findCustomers(includeArchived = false): Promise<CustomerRecord[]> {
    let query = this.db.selectFrom('customers').select(['id', 'name', 'kind', 'nui', 'phone', 'note', 'archived_at', 'created_at']);
    if (!includeArchived) query = query.where('archived_at', 'is', null);
    return query.orderBy('name').execute();
  }

  async findCustomer(id: number): Promise<CustomerRecord | undefined> {
    return this.db
      .selectFrom('customers')
      .select(['id', 'name', 'kind', 'nui', 'phone', 'note', 'archived_at', 'created_at'])
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Oldest first, for the customers given (all when left out). */
  async findEntries(customerIds?: number[]): Promise<TabEntryRecord[]> {
    if (customerIds && customerIds.length === 0) return [];
    let query = this.db
      .selectFrom('tab_entries as e')
      .leftJoin('sales as s', 's.id', 'e.sale_id')
      .leftJoin('returns as r', 'r.id', 'e.return_id')
      .leftJoin('users as u', 'u.id', 'e.created_by')
      .select([
        'e.id',
        'e.customer_id',
        'e.kind',
        'e.amount',
        'e.note',
        'e.sale_id',
        sql<boolean>`not ${counts}`.as('sale_undone'),
        'e.occurred_at',
        'u.name as created_by_name',
      ]);
    if (customerIds) query = query.where('e.customer_id', 'in', customerIds);
    return query.orderBy('e.occurred_at').orderBy('e.id').execute();
  }

  /** What's owed right now; read inside the transaction that adds a payment. */
  async balance(customerId: number): Promise<number> {
    const row = await sql<{ balance: string }>`
      select coalesce(sum(case when e.kind = 'charge' then e.amount else -e.amount end) filter (where ${counts}), 0) as balance
      from tab_entries e left join sales s on s.id = e.sale_id left join returns r on r.id = e.return_id
      where e.customer_id = ${customerId}
    `.execute(this.db);
    return Number(row.rows[0]!.balance);
  }

  /** For each sale charged to these customers' tabs, the invoice it is on (if any). */
  async chargeInvoices(customerIds: number[]): Promise<Map<number, { id: number; number: string; issuedAt: Date; dueDate: string | null }>> {
    if (customerIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('tab_entries as e')
      .innerJoin('document_lines as l', 'l.sale_id', 'e.sale_id')
      .innerJoin('documents as d', 'd.id', 'l.document_id')
      .select(['e.sale_id', 'd.id', 'd.number', 'd.issued_at', sql<string | null>`to_char(d.due_date, 'YYYY-MM-DD')`.as('due_date')])
      .where('e.customer_id', 'in', customerIds)
      .where('e.kind', '=', 'charge')
      .where('d.kind', '=', 'invoice')
      .orderBy('d.id')
      .execute();
    return new Map(rows.map((row) => [row.sale_id!, { id: row.id, number: row.number, issuedAt: row.issued_at, dueDate: row.due_date }]));
  }

  /** What these customers' payments were said to be for. */
  allocations(customerIds: number[]) {
    if (customerIds.length === 0) return Promise.resolve([]);
    return this.db
      .selectFrom('tab_allocations as a')
      .innerJoin('tab_entries as e', 'e.id', 'a.payment_id')
      .select(['a.payment_id', 'a.document_id', 'a.amount', 'e.customer_id'])
      .where('e.customer_id', 'in', customerIds)
      .execute();
  }

  /** The customer whose tab a sale was put on, if it was. */
  async customerOfSale(saleId: number): Promise<number | undefined> {
    const row = await this.db
      .selectFrom('tab_entries')
      .select('customer_id')
      .where('sale_id', '=', saleId)
      .where('kind', '=', 'charge')
      .executeTakeFirst();
    return row?.customer_id;
  }

  /**
   * How tabs changed the cash in the drawer each day (shop clock): payments
   * came in, tab sales didn't, and refunds taken off a tab weren't paid out.
   * Days without tab activity are left out.
   */
  async drawerEffectByDay(from: string, to: string, timeZone: string): Promise<Map<string, number>> {
    const result = await sql<{ day: string; effect: string }>`
      select to_char((e.occurred_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as day,
             sum(case when e.kind = 'charge' then -e.amount else e.amount end) as effect
      from tab_entries e left join sales s on s.id = e.sale_id left join returns r on r.id = e.return_id
      where ${counts}
        -- A payment that went to the bank or another place never reached the shop's till.
        and (e.kind <> 'payment' or e.place_id is null or e.place_id = (select id from money_places where kind = 'till' and carwash_id is null))
        and (e.occurred_at at time zone ${timeZone})::date between ${from}::date and ${to}::date
      group by 1
    `.execute(this.db);
    return new Map(result.rows.map((row) => [row.day, Number(row.effect)]));
  }

  /**
   * What each registered customer bought, from the invoices made out to them
   * (tab or paid at the till) less their credit notes: in all, since
   * `yearStart`, how many purchases and when the last one was. Customers
   * who never bought anything are left out.
   */
  async purchaseTotals(yearStart: Date, customerIds?: number[]): Promise<Map<number, PurchaseTotals>> {
    if (customerIds && customerIds.length === 0) return new Map();
    let query = this.db
      .selectFrom('documents')
      .select([
        'customer_id',
        sql<string>`sum(case when kind = 'invoice' then total else -total end)`.as('spent'),
        sql<string>`coalesce(sum(case when kind = 'invoice' then total else -total end) filter (where issued_at >= ${yearStart}), 0)`.as('spent_this_year'),
        sql<string>`count(*) filter (where kind = 'invoice')`.as('purchases'),
        sql<Date | null>`max(issued_at) filter (where kind = 'invoice')`.as('last_purchase_at'),
      ])
      .where('customer_id', 'is not', null)
      .groupBy('customer_id');
    if (customerIds) query = query.where('customer_id', 'in', customerIds);
    const rows = await query.execute();
    return new Map(
      rows.map((row) => [
        row.customer_id!,
        { spent: Number(row.spent), spentThisYear: Number(row.spent_this_year), purchases: Number(row.purchases), lastPurchaseAt: row.last_purchase_at },
      ]),
    );
  }

  /** What a customer buys most, by money spent, returns taken off. */
  async topProducts(customerId: number, limit = 8): Promise<Array<{ productId: number; name: string; quantity: number; total: number }>> {
    const rows = await this.db
      .selectFrom('document_lines as l')
      .innerJoin('documents as d', 'd.id', 'l.document_id')
      .innerJoin('sales as s', 's.id', 'l.sale_id')
      .select([
        's.product_id',
        sql<string>`max(l.product_name)`.as('name'),
        sql<string>`sum(case when d.kind = 'invoice' then l.quantity else -l.quantity end)`.as('quantity'),
        sql<string>`sum(case when d.kind = 'invoice' then l.total else -l.total end)`.as('total'),
      ])
      .where('d.customer_id', '=', customerId)
      .groupBy('s.product_id')
      .having(sql<boolean>`sum(case when d.kind = 'invoice' then l.quantity else -l.quantity end) > 0`)
      .orderBy(sql`4`, 'desc')
      .limit(limit)
      .execute();
    return rows.map((row) => ({ productId: row.product_id, name: row.name, quantity: Number(row.quantity), total: Number(row.total) }));
  }

  async createCustomer(input: CustomerFields & { createdBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('customers')
      .values({ name: input.name, kind: input.kind, nui: input.nui, phone: input.phone, note: input.note, created_by: input.createdBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updateCustomer(id: number, changes: CustomerFields): Promise<void> {
    await this.db.updateTable('customers').set(changes).where('id', '=', id).execute();
  }

  async archiveCustomer(id: number, at: Date): Promise<void> {
    await this.db.updateTable('customers').set({ archived_at: at }).where('id', '=', id).execute();
  }

  async addEntry(entry: {
    customerId: number;
    kind: TabEntryKind;
    amount: number;
    note: string | null;
    saleId: number | null;
    returnId?: number;
    createdBy: number;
    occurredAt?: Date;
    /** A payment: where the money arrived. */
    placeId?: number | null;
  }): Promise<number> {
    const row = await this.db
      .insertInto('tab_entries')
      .values({
        customer_id: entry.customerId,
        kind: entry.kind,
        amount: entry.amount,
        note: entry.note,
        sale_id: entry.saleId,
        return_id: entry.returnId ?? null,
        created_by: entry.createdBy,
        place_id: entry.placeId ?? null,
        ...(entry.occurredAt && { occurred_at: entry.occurredAt }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }
}
