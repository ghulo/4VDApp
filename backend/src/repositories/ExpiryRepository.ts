import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export interface ExpiryRecord {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  /** "2026-10-12" */
  expires_on: string;
  note: string | null;
  created_by_name: string | null;
  cleared_at: Date | null;
  /** Units of the product on the shelf right now. */
  stock: number;
}

export class ExpiryRepository {
  constructor(private readonly db: DatabaseClient) {}

  private baseQuery() {
    return this.db
      .selectFrom('expiry_dates as x')
      .innerJoin('products as p', 'p.id', 'x.product_id')
      .leftJoin('users as u', 'u.id', 'x.created_by')
      .leftJoin('inventory as i', 'i.product_id', 'x.product_id')
      .select([
        'x.id',
        'x.product_id',
        'p.name as product_name',
        'x.quantity',
        sql<string>`to_char(x.expires_on, 'YYYY-MM-DD')`.as('expires_on'),
        'x.note',
        'u.name as created_by_name',
        'x.cleared_at',
        sql<number>`coalesce(i.quantity_on_hand, 0)`.as('stock'),
      ]);
  }

  /** Not yet dealt with, soonest first; for one product or all of them. */
  async findOpen(filter: { productId?: number }): Promise<ExpiryRecord[]> {
    let query = this.baseQuery().where('x.cleared_at', 'is', null);
    if (filter.productId !== undefined) query = query.where('x.product_id', '=', filter.productId);
    return query.orderBy('x.expires_on').orderBy('x.id').execute();
  }

  async findById(id: number): Promise<ExpiryRecord | undefined> {
    return this.baseQuery().where('x.id', '=', id).executeTakeFirst();
  }

  async add(entry: { productId: number; quantity: number; expiresOn: string; note: string | null; orderLineId: number | null; createdBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('expiry_dates')
      .values({
        product_id: entry.productId,
        quantity: entry.quantity,
        expires_on: entry.expiresOn,
        note: entry.note,
        order_line_id: entry.orderLineId,
        created_by: entry.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async clear(id: number, by: number, at: Date): Promise<void> {
    await this.db.updateTable('expiry_dates').set({ cleared_by: by, cleared_at: at }).where('id', '=', id).execute();
  }
}
