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
  refund_card: string;
  refund_transfer: string;
  refund_tab: string | null;
  card_approval_code: string | null;
  refund_to: string | null;
  refund_iban: string | null;
  transfer_sent_on: string | null;
}

/** How the money of a new return goes back; the rest is cash. Tab null: the old rule (off the tab first). */
export interface RefundParts {
  card: number;
  transfer: number;
  tab: number | null;
  approvalCode: string | null;
  customerName: string | null;
  iban: string | null;
  batch: string | null;
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
  /** Set when the sale was undone; it can't be returned then. */
  undone_at: Date | null;
  /** Units already returned or waiting for approval (undone returns don't count). */
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
  refundBy: RefundParts;
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
        'r.refund_card',
        'r.refund_transfer',
        'r.refund_tab',
        'r.card_approval_code',
        'r.refund_to',
        'r.refund_iban',
        sql<string | null>`to_char(r.transfer_sent_on, 'YYYY-MM-DD')`.as('transfer_sent_on'),
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
      .select(['s.id', 's.product_id', 'p.name as product_name', 's.quantity_sold', 's.price_per_unit', 's.sold_by', 's.sale_date', 's.undone_at'])
      .where('s.id', '=', saleId)
      .forUpdate('s')
      .executeTakeFirst();
    if (!sale) return undefined;
    const returned = await this.db
      .selectFrom('returns')
      .select(sql<string>`coalesce(sum(quantity), 0)`.as('units'))
      .where('sale_id', '=', saleId)
      .where('status', 'in', ['pending', 'approved'])
      .where('undone_at', 'is', null)
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
        refund_card: item.refundBy.card,
        refund_transfer: item.refundBy.transfer,
        refund_tab: item.refundBy.tab,
        card_approval_code: item.refundBy.approvalCode,
        refund_to: item.refundBy.customerName,
        refund_iban: item.refundBy.iban,
        refund_batch: item.refundBy.batch,
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

  /** The sale, its invoice (if it has one) and the customer whose tab it went on, for the refund screen. */
  async refundInfo(saleId: number): Promise<RefundInfoRecord | undefined> {
    const { rows } = await sql<RefundInfoRecord>`
      select s.sold_by, s.sale_date, d.number, d.payment_method, d.card_amount, d.total,
        (select c.name from tab_entries t join customers c on c.id = t.customer_id where t.sale_id = s.id and t.kind = 'charge' limit 1) as tab_customer
      from sales s
      left join lateral (
        select d.number, d.payment_method, d.card_amount, d.total from document_lines dl join documents d on d.id = dl.document_id
        where dl.sale_id = s.id and d.kind = 'invoice' order by d.id desc limit 1
      ) d on true
      where s.id = ${saleId}
    `.execute(this.db);
    return rows[0];
  }

  /** Approved bank-transfer refunds not sent yet, the lines of one refund together, oldest first. */
  async transfersOwed(): Promise<TransferOwedRecord[]> {
    const { rows } = await sql<TransferOwedRecord>`
      select array_agg(r.id order by r.id) as return_ids, min(r.refund_to) as customer_name, min(r.refund_iban) as iban,
        sum(r.refund_transfer) as amount, to_char(min(r.decided_at), 'YYYY-MM-DD') as day,
        min((select d.number from document_lines dl join documents d on d.id = dl.document_id
             where dl.sale_id = r.sale_id and d.kind = 'invoice' order by d.id desc limit 1)) as receipt_number
      from returns r join sales s on s.id = r.sale_id
      where r.status = 'approved' and r.undone_at is null and s.undone_at is null
        and r.refund_transfer > 0 and r.transfer_sent_on is null
      group by coalesce(r.refund_batch::text, 'r' || r.id)
      order by min(r.decided_at), min(r.id)
    `.execute(this.db);
    return rows;
  }

  /** Lock refunds about to be marked sent, so a double press can't send them twice. Must run in a transaction. */
  lockTransfers(ids: number[]) {
    return this.db
      .selectFrom('returns')
      .select(['id', 'status', 'undone_at', 'refund_transfer', 'refund_to', sql<string | null>`to_char(transfer_sent_on, 'YYYY-MM-DD')`.as('transfer_sent_on')])
      .where('id', 'in', ids)
      .orderBy('id')
      .forUpdate()
      .execute();
  }

  async markTransfersSent(ids: number[], sent: { day: string; placeId: number; by: number; at: Date }): Promise<void> {
    await this.db
      .updateTable('returns')
      .set({ transfer_sent_on: sent.day, transfer_sent_from: sent.placeId, transfer_sent_by: sent.by, transfer_sent_at: sent.at })
      .where('id', 'in', ids)
      .execute();
  }

  /** Whether a return's bank-transfer refund has gone already. */
  async transferSent(id: number): Promise<boolean> {
    const row = await this.db.selectFrom('returns').select('transfer_sent_on').where('id', '=', id).executeTakeFirst();
    return row?.transfer_sent_on != null;
  }
}

export interface RefundInfoRecord {
  sold_by: number | null;
  sale_date: Date;
  number: string | null;
  payment_method: 'till' | 'account' | 'card' | null;
  card_amount: string | null;
  total: string | null;
  tab_customer: string | null;
}

export interface TransferOwedRecord {
  return_ids: number[];
  customer_name: string;
  iban: string | null;
  amount: string;
  day: string;
  receipt_number: string | null;
}
