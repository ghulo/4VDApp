import { sql } from 'kysely';
import type { ApprovalStatus, ReturnCondition } from '../constants/approvals.js';
import type { DatabaseClient } from '../database/connection.js';
import type { Decision } from './WriteOffRepository.js';

export interface ReturnRecord {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  refund_amount: string;
  condition: ReturnCondition;
  notes: string | null;
  approval_reasons: string[];
  status: ApprovalStatus;
  sold_by: number | null;
  sold_by_name: string | null;
  sale_date: Date;
  requested_by: number | null;
  requested_by_name: string | null;
  requested_at: Date;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_note: string | null;
}

/** The sale fields a return needs, read while the sale row is locked. */
export interface LockedSale {
  id: number;
  product_id: number;
  product_name: string;
  quantity_sold: number;
  price_per_unit: string;
  sold_by: number | null;
  sale_date: Date;
  /** Units already returned or waiting for approval. */
  returned_quantity: number;
}

export interface NewReturn {
  saleId: number;
  quantity: number;
  refundAmount: number;
  condition: ReturnCondition;
  notes: string | null;
  approvalReasons: string[];
  requestedBy: number;
}

export class ReturnRepository {
  constructor(private readonly db: DatabaseClient) {}

  private baseQuery() {
    return this.db
      .selectFrom('returns as r')
      .innerJoin('sales as s', 's.id', 'r.sale_id')
      .innerJoin('products as p', 'p.id', 's.product_id')
      .leftJoin('users as sb', 'sb.id', 's.sold_by')
      .leftJoin('users as rq', 'rq.id', 'r.requested_by')
      .leftJoin('users as dc', 'dc.id', 'r.decided_by')
      .select([
        'r.id',
        'r.sale_id',
        's.product_id',
        'p.name as product_name',
        'r.quantity',
        'r.refund_amount',
        'r.condition',
        'r.notes',
        'r.approval_reasons',
        'r.status',
        's.sold_by',
        'sb.name as sold_by_name',
        's.sale_date',
        'r.requested_by',
        'rq.name as requested_by_name',
        'r.requested_at',
        'r.decided_by',
        'dc.name as decided_by_name',
        'r.decided_at',
        'r.decision_note',
      ]);
  }

  /**
   * Lock the sale so two returns of it at the same moment can't both pass the
   * "units left" check. Must run in a transaction.
   */
  async lockSale(saleId: number): Promise<LockedSale | undefined> {
    const sale = await this.db
      .selectFrom('sales as s')
      .innerJoin('products as p', 'p.id', 's.product_id')
      .select(['s.id', 's.product_id', 'p.name as product_name', 's.quantity_sold', 's.price_per_unit', 's.sold_by', 's.sale_date'])
      .where('s.id', '=', saleId)
      .forUpdate('s')
      .executeTakeFirst();
    if (!sale) return undefined;
    const returned = await this.db
      .selectFrom('returns')
      .select(sql<string>`coalesce(sum(quantity), 0)`.as('units'))
      .where('sale_id', '=', saleId)
      .where('status', 'in', ['pending', 'approved'])
      .executeTakeFirstOrThrow();
    return { ...sale, returned_quantity: Number(returned.units) };
  }

  async create(item: NewReturn): Promise<number> {
    const row = await this.db
      .insertInto('returns')
      .values({
        sale_id: item.saleId,
        quantity: item.quantity,
        refund_amount: item.refundAmount,
        condition: item.condition,
        notes: item.notes,
        approval_reasons: item.approvalReasons,
        status: 'pending',
        requested_by: item.requestedBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  findById(id: number): Promise<ReturnRecord | undefined> {
    return this.baseQuery().where('r.id', '=', id).executeTakeFirst();
  }

  async lockStatus(id: number): Promise<ApprovalStatus | undefined> {
    const row = await this.db.selectFrom('returns').select('status').where('id', '=', id).forUpdate().executeTakeFirst();
    return row?.status;
  }

  findMany(filters: { status?: ApprovalStatus; limit: number }): Promise<ReturnRecord[]> {
    let query = this.baseQuery();
    if (filters.status) query = query.where('r.status', '=', filters.status);
    return query.orderBy('r.requested_at', 'desc').orderBy('r.id', 'desc').limit(filters.limit).execute();
  }

  async decide(id: number, decision: Decision): Promise<void> {
    await this.db
      .updateTable('returns')
      .set({ status: decision.status, decided_by: decision.decidedBy, decided_at: new Date(), decision_note: decision.note })
      .where('id', '=', id)
      .execute();
  }
}
