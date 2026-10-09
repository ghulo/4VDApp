import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { SupplierPaymentMethod } from '../database/types.js';

export interface BillRecord {
  id: number;
  supplier_id: number;
  supplier_name: string;
  order_id: number | null;
  number: string | null;
  /** "2026-10-09" */
  issued_on: string;
  due_on: string | null;
  amount: string;
  /** Paid so far, voided payments left out. */
  paid: string;
  note: string | null;
  photo_media_id: string | null;
  created_by_name: string | null;
  created_at: Date;
  voided_at: Date | null;
  void_note: string | null;
}

export interface PaymentRecord {
  id: number;
  bill_id: number;
  amount: string;
  paid_on: string;
  method: SupplierPaymentMethod;
  note: string | null;
  created_by_name: string | null;
  created_at: Date;
  voided_at: Date | null;
}

export interface NewBill {
  supplierId: number;
  orderId: number | null;
  number: string | null;
  issuedOn: string;
  dueOn: string | null;
  amount: number;
  note: string | null;
  createdBy: number;
}

export interface BillFilters {
  supplierId?: number;
  /** open: something left to pay; paid: nothing left; void: voided. */
  status?: 'open' | 'paid' | 'void';
}

const paid = sql<string>`coalesce((
  select sum(p.amount) from supplier_payments p where p.bill_id = b.id and p.voided_at is null
), 0)`;

export class SupplierBillRepository {
  constructor(private readonly db: DatabaseClient) {}

  private baseQuery() {
    return this.db
      .selectFrom('supplier_bills as b')
      .innerJoin('suppliers as s', 's.id', 'b.supplier_id')
      .leftJoin('users as u', 'u.id', 'b.created_by')
      .select([
        'b.id',
        'b.supplier_id',
        's.name as supplier_name',
        'b.order_id',
        'b.number',
        sql<string>`to_char(b.issued_on, 'YYYY-MM-DD')`.as('issued_on'),
        sql<string | null>`to_char(b.due_on, 'YYYY-MM-DD')`.as('due_on'),
        'b.amount',
        paid.as('paid'),
        'b.note',
        'b.photo_media_id',
        'u.name as created_by_name',
        'b.created_at',
        'b.voided_at',
        'b.void_note',
      ]);
  }

  /** Bills with money left to pay come first, the oldest due date first. */
  findMany(filters: BillFilters): Promise<BillRecord[]> {
    let query = this.baseQuery();
    if (filters.supplierId !== undefined) query = query.where('b.supplier_id', '=', filters.supplierId);
    if (filters.status === 'void') query = query.where('b.voided_at', 'is not', null);
    else if (filters.status) {
      query = query
        .where('b.voided_at', 'is', null)
        .where(filters.status === 'open' ? sql<boolean>`${paid} < b.amount` : sql<boolean>`${paid} >= b.amount`);
    }
    return query
      .orderBy(sql`b.voided_at is not null`)
      .orderBy(sql`${paid} >= b.amount`)
      .orderBy(sql`coalesce(b.due_on, b.issued_on)`)
      .orderBy('b.id', 'desc')
      .limit(500)
      .execute();
  }

  findById(id: number): Promise<BillRecord | undefined> {
    return this.baseQuery().where('b.id', '=', id).executeTakeFirst();
  }

  /** Locks the bill so two payments can't both take what's left. */
  async lock(id: number): Promise<void> {
    await this.db.selectFrom('supplier_bills').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
  }

  findPayments(billIds: number[]): Promise<PaymentRecord[]> {
    if (billIds.length === 0) return Promise.resolve([]);
    return this.db
      .selectFrom('supplier_payments as p')
      .leftJoin('users as u', 'u.id', 'p.created_by')
      .select([
        'p.id',
        'p.bill_id',
        'p.amount',
        sql<string>`to_char(p.paid_on, 'YYYY-MM-DD')`.as('paid_on'),
        'p.method',
        'p.note',
        'u.name as created_by_name',
        'p.created_at',
        'p.voided_at',
      ])
      .where('p.bill_id', 'in', billIds)
      .orderBy('p.paid_on')
      .orderBy('p.id')
      .execute();
  }

  findPayment(id: number) {
    return this.db.selectFrom('supplier_payments').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async create(bill: NewBill): Promise<number> {
    const row = await this.db
      .insertInto('supplier_bills')
      .values({
        supplier_id: bill.supplierId,
        order_id: bill.orderId,
        number: bill.number,
        issued_on: bill.issuedOn,
        due_on: bill.dueOn,
        amount: bill.amount,
        note: bill.note,
        created_by: bill.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async update(id: number, changes: { number: string | null; issuedOn: string; dueOn: string | null; amount: number; note: string | null }) {
    await this.db
      .updateTable('supplier_bills')
      .set({ number: changes.number, issued_on: changes.issuedOn, due_on: changes.dueOn, amount: changes.amount, note: changes.note })
      .where('id', '=', id)
      .execute();
  }

  async setPhoto(id: number, mediaId: string | null): Promise<void> {
    await this.db.updateTable('supplier_bills').set({ photo_media_id: mediaId }).where('id', '=', id).execute();
  }

  async void(id: number, by: number, note: string, at: Date): Promise<void> {
    await this.db.updateTable('supplier_bills').set({ voided_at: at, voided_by: by, void_note: note }).where('id', '=', id).execute();
  }

  async addPayment(payment: { billId: number; amount: number; paidOn: string; method: SupplierPaymentMethod; note: string | null; createdBy: number }) {
    const row = await this.db
      .insertInto('supplier_payments')
      .values({
        bill_id: payment.billId,
        amount: payment.amount,
        paid_on: payment.paidOn,
        method: payment.method,
        note: payment.note,
        created_by: payment.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async voidPayment(id: number, by: number, at: Date): Promise<void> {
    await this.db.updateTable('supplier_payments').set({ voided_at: at, voided_by: by }).where('id', '=', id).execute();
  }

  /** Cash taken out of the shop drawer to pay suppliers, per day ("2026-10-09" -> euros). */
  async drawerPaymentsByDay(from: string, to: string): Promise<Map<string, number>> {
    const rows = await this.db
      .selectFrom('supplier_payments')
      .select([sql<string>`to_char(paid_on, 'YYYY-MM-DD')`.as('day'), sql<string>`sum(amount)`.as('total')])
      .where('method', '=', 'drawer')
      .where('voided_at', 'is', null)
      .where('paid_on', '>=', from)
      .where('paid_on', '<=', to)
      .groupBy('paid_on')
      .execute();
    return new Map(rows.map((row) => [row.day, Number(row.total)]));
  }

  /** Paid in a range of days, voided payments left out. */
  async paidBetween(from: string, to: string): Promise<{ total: number; count: number }> {
    const row = await this.db
      .selectFrom('supplier_payments')
      .select([sql<string>`coalesce(sum(amount), 0)`.as('total'), sql<string>`count(*)`.as('count')])
      .where('voided_at', 'is', null)
      .where('paid_on', '>=', from)
      .where('paid_on', '<=', to)
      .executeTakeFirstOrThrow();
    return { total: Number(row.total), count: Number(row.count) };
  }
}
