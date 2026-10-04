import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export interface CustomerRecord {
  id: number;
  name: string;
  phone: string | null;
  note: string | null;
  archived_at: Date | null;
  created_at: Date;
}

export interface TabEntryRecord {
  id: number;
  customer_id: number;
  kind: 'charge' | 'payment';
  amount: string;
  note: string | null;
  sale_id: number | null;
  /** True when the charge's sale was undone, so it no longer counts. */
  sale_undone: boolean;
  occurred_at: Date;
  created_by_name: string | null;
}

/** Charges on undone sales don't count; everything else does. */
const counts = sql<boolean>`(e.sale_id is null or s.undone_at is null)`;

export class TabRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findCustomers(includeArchived = false): Promise<CustomerRecord[]> {
    let query = this.db.selectFrom('customers').select(['id', 'name', 'phone', 'note', 'archived_at', 'created_at']);
    if (!includeArchived) query = query.where('archived_at', 'is', null);
    return query.orderBy('name').execute();
  }

  async findCustomer(id: number): Promise<CustomerRecord | undefined> {
    return this.db
      .selectFrom('customers')
      .select(['id', 'name', 'phone', 'note', 'archived_at', 'created_at'])
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Oldest first, for the customers given (all when left out). */
  async findEntries(customerIds?: number[]): Promise<TabEntryRecord[]> {
    if (customerIds && customerIds.length === 0) return [];
    let query = this.db
      .selectFrom('tab_entries as e')
      .leftJoin('sales as s', 's.id', 'e.sale_id')
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
      from tab_entries e left join sales s on s.id = e.sale_id
      where e.customer_id = ${customerId}
    `.execute(this.db);
    return Number(row.rows[0]!.balance);
  }

  /**
   * How tabs changed the cash in the drawer each day (shop clock): payments
   * came in, tab sales didn't. Days without tab activity are left out.
   */
  async drawerEffectByDay(from: string, to: string, timeZone: string): Promise<Map<string, number>> {
    const result = await sql<{ day: string; effect: string }>`
      select to_char((e.occurred_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as day,
             sum(case when e.kind = 'payment' then e.amount else -e.amount end) as effect
      from tab_entries e left join sales s on s.id = e.sale_id
      where ${counts} and (e.occurred_at at time zone ${timeZone})::date between ${from}::date and ${to}::date
      group by 1
    `.execute(this.db);
    return new Map(result.rows.map((row) => [row.day, Number(row.effect)]));
  }

  async createCustomer(input: { name: string; phone: string | null; note: string | null; createdBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('customers')
      .values({ name: input.name, phone: input.phone, note: input.note, created_by: input.createdBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updateCustomer(id: number, changes: { name: string; phone: string | null; note: string | null }): Promise<void> {
    await this.db.updateTable('customers').set(changes).where('id', '=', id).execute();
  }

  async archiveCustomer(id: number, at: Date): Promise<void> {
    await this.db.updateTable('customers').set({ archived_at: at }).where('id', '=', id).execute();
  }

  async addEntry(entry: {
    customerId: number;
    kind: 'charge' | 'payment';
    amount: number;
    note: string | null;
    saleId: number | null;
    createdBy: number;
    occurredAt?: Date;
  }): Promise<number> {
    const row = await this.db
      .insertInto('tab_entries')
      .values({
        customer_id: entry.customerId,
        kind: entry.kind,
        amount: entry.amount,
        note: entry.note,
        sale_id: entry.saleId,
        created_by: entry.createdBy,
        ...(entry.occurredAt && { occurred_at: entry.occurredAt }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }
}
