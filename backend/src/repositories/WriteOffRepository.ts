import type { ApprovalStatus, WriteOffReason } from '../constants/approvals.js';
import type { DatabaseClient } from '../database/connection.js';

export interface WriteOffRecord {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  reason: WriteOffReason;
  unit_cost: string | null;
  return_id: number | null;
  notes: string | null;
  status: ApprovalStatus;
  requested_by: number | null;
  requested_by_name: string | null;
  requested_at: Date;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_note: string | null;
}

export interface NewWriteOff {
  productId: number;
  quantity: number;
  reason: WriteOffReason;
  unitCost: number | null;
  returnId: number | null;
  notes: string | null;
  requestedBy: number;
}

export interface Decision {
  status: 'approved' | 'rejected';
  decidedBy: number;
  note: string | null;
}

export class WriteOffRepository {
  constructor(private readonly db: DatabaseClient) {}

  private baseQuery() {
    return this.db
      .selectFrom('write_offs as w')
      .innerJoin('products as p', 'p.id', 'w.product_id')
      .leftJoin('users as rq', 'rq.id', 'w.requested_by')
      .leftJoin('users as dc', 'dc.id', 'w.decided_by')
      .select([
        'w.id',
        'w.product_id',
        'p.name as product_name',
        'w.quantity',
        'w.reason',
        'w.unit_cost',
        'w.return_id',
        'w.notes',
        'w.status',
        'w.requested_by',
        'rq.name as requested_by_name',
        'w.requested_at',
        'w.decided_by',
        'dc.name as decided_by_name',
        'w.decided_at',
        'w.decision_note',
      ]);
  }

  async create(writeOff: NewWriteOff): Promise<number> {
    const row = await this.db
      .insertInto('write_offs')
      .values({
        product_id: writeOff.productId,
        quantity: writeOff.quantity,
        reason: writeOff.reason,
        unit_cost: writeOff.unitCost,
        return_id: writeOff.returnId,
        notes: writeOff.notes,
        status: 'pending',
        requested_by: writeOff.requestedBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  findById(id: number): Promise<WriteOffRecord | undefined> {
    return this.baseQuery().where('w.id', '=', id).executeTakeFirst();
  }

  /** Lock the row so two people can't decide on it at the same time. Returns its status. */
  async lockStatus(id: number): Promise<ApprovalStatus | undefined> {
    const row = await this.db.selectFrom('write_offs').select('status').where('id', '=', id).forUpdate().executeTakeFirst();
    return row?.status;
  }

  findMany(filters: { status?: ApprovalStatus; limit: number }): Promise<WriteOffRecord[]> {
    let query = this.baseQuery();
    if (filters.status) query = query.where('w.status', '=', filters.status);
    return query.orderBy('w.requested_at', 'desc').orderBy('w.id', 'desc').limit(filters.limit).execute();
  }

  async decide(id: number, decision: Decision): Promise<void> {
    await this.db
      .updateTable('write_offs')
      .set({ status: decision.status, decided_by: decision.decidedBy, decided_at: new Date(), decision_note: decision.note })
      .where('id', '=', id)
      .execute();
  }
}
