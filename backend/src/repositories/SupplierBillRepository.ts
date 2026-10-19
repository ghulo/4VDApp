import { sql } from 'kysely';
import type { BillKind, BillLineKind, CustomsPaidMethod, WithholdingType } from '../constants/bills.js';
import type { ExpensePlace } from '../constants/expenses.js';
import type { DatabaseClient } from '../database/connection.js';
import type { MoneyPlaceKind, SupplierPaymentMethod } from '../database/types.js';
import type { RecordSource } from '../validators/validate.js';

export interface BillRecord {
  id: number;
  supplier_id: number | null;
  supplier_name: string | null;
  order_id: number | null;
  number: string | null;
  /** "2026-10-09" */
  issued_on: string;
  due_on: string | null;
  /** What the supplier is owed: the paper's total less any tax held back. */
  amount: string;
  vat_amount: string | null;
  /** Paid so far, voided payments left out. A return or credit: how much of it went against its bill. */
  paid: string;
  note: string | null;
  photo_media_id: string | null;
  created_by_name: string | null;
  created_at: Date;
  voided_at: Date | null;
  void_note: string | null;
  /** The scan it was confirmed from, if any. */
  scan_id: number | null;
  kind: BillKind;
  credit_for_id: number | null;
  credit_for_number: string | null;
  returns_stock: boolean;
  prices_include_vat: boolean;
  abroad: boolean;
  customs_vat: string | null;
  customs_duty: string | null;
  customs_paid_method: CustomsPaidMethod | null;
  withholding_type: WithholdingType | null;
  withheld: string;
  paid_now: boolean;
  place: ExpensePlace;
  carwash_id: number | null;
  carwash_name: string | null;
  repeat_id: number | null;
  /** The VAT month it counts in when its own month was filed before it came; null: its own month. */
  vat_month: string | null;
  /** Set on a bill from TREFIN's history, only to look at. */
  trefin_ref: string | null;
}

export interface PaymentRecord {
  id: number;
  bill_id: number;
  /** For a credit payment: the return or credit it applied. */
  credit_id: number | null;
  credit_number: string | null;
  amount: string;
  paid_on: string;
  method: SupplierPaymentMethod;
  place_id: number | null;
  place_kind: MoneyPlaceKind | null;
  /** The place's own name, else its carwash's; null for the shop's till and the safe. */
  place_name: string | null;
  group_id: number | null;
  note: string | null;
  created_by_name: string | null;
  created_at: Date;
  voided_at: Date | null;
}

export interface NewBill {
  supplierId: number | null;
  orderId: number | null;
  number: string | null;
  issuedOn: string;
  dueOn: string | null;
  amount: number;
  vatAmount?: number | null;
  note: string | null;
  createdBy: number | null;
  kind?: BillKind;
  creditForId?: number | null;
  returnsStock?: boolean;
  pricesIncludeVat?: boolean;
  abroad?: boolean;
  customs?: { vat: number; duty: number; method: CustomsPaidMethod } | null;
  withholdingType?: WithholdingType | null;
  withheld?: number;
  paidNow?: boolean;
  place?: ExpensePlace;
  carwashId?: number | null;
  repeatId?: number | null;
}

export interface BillLineRecord {
  id: number;
  bill_id: number;
  position: number;
  kind: BillLineKind;
  product_id: number | null;
  product_name: string | null;
  quantity: number | null;
  unit_price: string | null;
  category: string | null;
  description: string | null;
  vat_rate: number;
  vat_exempt: boolean;
  net: string;
  vat: string;
  landed: string;
  spread: boolean;
  self_vat: string;
  order_line_id: number | null;
}

export interface NewBillLine {
  kind: BillLineKind;
  productId: number | null;
  quantity: number | null;
  unitPrice: number | null;
  category: string | null;
  description: string | null;
  vatRate: number;
  vatExempt: boolean;
  net: number;
  vat: number;
  landed: number;
  spread: boolean;
  selfVat: number;
  orderLineId: number | null;
}

export interface BillFilters {
  supplierId?: number;
  /** open: something left to pay; paid: nothing left; void: voided. */
  status?: 'open' | 'paid' | 'void';
  /** 4vd: made here; trefin: TREFIN's history. */
  source?: RecordSource;
}

/** Paid on a bill; for a return or credit, how much of it went against its bill. */
const paid = sql<string>`coalesce(case when b.kind = 'credit'
  then (select sum(p.amount) from supplier_payments p where p.credit_id = b.id and p.voided_at is null)
  else (select sum(p.amount) from supplier_payments p where p.bill_id = b.id and p.voided_at is null)
end, 0)`;

export class SupplierBillRepository {
  constructor(private readonly db: DatabaseClient) {}

  private baseQuery() {
    return this.db
      .selectFrom('supplier_bills as b')
      .leftJoin('suppliers as s', 's.id', 'b.supplier_id')
      .leftJoin('users as u', 'u.id', 'b.created_by')
      .leftJoin('carwashes as w', 'w.id', 'b.carwash_id')
      .leftJoin('supplier_bills as original', 'original.id', 'b.credit_for_id')
      .select([
        'b.id',
        'b.supplier_id',
        's.name as supplier_name',
        'b.order_id',
        'b.number',
        sql<string>`to_char(b.issued_on, 'YYYY-MM-DD')`.as('issued_on'),
        sql<string | null>`to_char(b.vat_month, 'YYYY-MM-DD')`.as('vat_month'),
        sql<string | null>`to_char(b.due_on, 'YYYY-MM-DD')`.as('due_on'),
        'b.amount',
        'b.vat_amount',
        paid.as('paid'),
        'b.note',
        'b.photo_media_id',
        'u.name as created_by_name',
        'b.created_at',
        'b.voided_at',
        'b.void_note',
        sql<number | null>`(select bs.id from bill_scans bs where bs.bill_id = b.id limit 1)`.as('scan_id'),
        'b.kind',
        'b.credit_for_id',
        'original.number as credit_for_number',
        'b.returns_stock',
        'b.prices_include_vat',
        'b.abroad',
        'b.customs_vat',
        'b.customs_duty',
        'b.customs_paid_method',
        'b.withholding_type',
        'b.withheld',
        'b.paid_now',
        'b.place',
        'b.carwash_id',
        'w.name as carwash_name',
        'b.repeat_id',
        'b.trefin_ref',
      ]);
  }

  /** Bills with money left to pay come first, the oldest due date first. */
  findMany(filters: BillFilters): Promise<BillRecord[]> {
    let query = this.baseQuery();
    if (filters.supplierId !== undefined) query = query.where('b.supplier_id', '=', filters.supplierId);
    if (filters.source) query = query.where('b.trefin_ref', filters.source === 'trefin' ? 'is not' : 'is', null);
    if (filters.status === 'void') query = query.where('b.voided_at', 'is not', null);
    else if (filters.status) {
      // A return or credit is listed with everything, never as something owed; TREFIN's history is neither open nor paid here.
      if (filters.status === 'open') query = query.where('b.kind', '=', 'bill');
      query = query
        .where('b.voided_at', 'is', null)
        .where('b.trefin_ref', 'is', null)
        .where(filters.status === 'open' ? sql<boolean>`${paid} < b.amount` : sql<boolean>`${paid} >= b.amount`);
    }
    // 4VD's own bills first, most urgent first; then TREFIN's history, newest first.
    return query
      .orderBy(sql`b.trefin_ref is not null`)
      .orderBy(sql`b.voided_at is not null`)
      .orderBy(sql`${paid} >= b.amount`)
      .orderBy(sql`case when b.trefin_ref is null then coalesce(b.due_on, b.issued_on) end`)
      .orderBy('b.issued_on', 'desc')
      .orderBy('b.id', 'desc')
      .limit(1500)
      .execute();
  }

  findById(id: number): Promise<BillRecord | undefined> {
    return this.baseQuery().where('b.id', '=', id).executeTakeFirst();
  }

  /** Returns and credits against a bill, voided ones too. */
  findCredits(billId: number): Promise<BillRecord[]> {
    return this.baseQuery().where('b.credit_for_id', '=', billId).orderBy('b.id').execute();
  }

  /** Locks the bill so two payments can't both take what's left. */
  async lock(id: number): Promise<void> {
    await this.db.selectFrom('supplier_bills').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
  }

  /** Payments on these bills, and for a return or credit, where it was applied. */
  findPayments(billIds: number[]): Promise<PaymentRecord[]> {
    if (billIds.length === 0) return Promise.resolve([]);
    return this.db
      .selectFrom('supplier_payments as p')
      .leftJoin('users as u', 'u.id', 'p.created_by')
      .leftJoin('supplier_bills as c', 'c.id', 'p.credit_id')
      .leftJoin('money_places as mp', 'mp.id', 'p.place_id')
      .leftJoin('carwashes as cw', 'cw.id', 'mp.carwash_id')
      .select([
        'p.id',
        'p.bill_id',
        'p.credit_id',
        'c.number as credit_number',
        'p.amount',
        sql<string>`to_char(p.paid_on, 'YYYY-MM-DD')`.as('paid_on'),
        'p.method',
        'p.place_id',
        'mp.kind as place_kind',
        sql<string | null>`coalesce(mp.name, cw.name)`.as('place_name'),
        'p.group_id',
        'p.note',
        'u.name as created_by_name',
        'p.created_at',
        'p.voided_at',
      ])
      .where((eb) => eb.or([eb('p.bill_id', 'in', billIds), eb('p.credit_id', 'in', billIds)]))
      .orderBy('p.paid_on')
      .orderBy('p.id')
      .execute();
  }

  findPayment(id: number) {
    return this.db.selectFrom('supplier_payments').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** Payments still standing on a bill (credits applied to it among them). */
  standingPayments(billId: number) {
    return this.db.selectFrom('supplier_payments').selectAll().where('bill_id', '=', billId).where('voided_at', 'is', null).execute();
  }

  /** Where a return or credit was applied, still standing. */
  creditPayments(creditId: number) {
    return this.db.selectFrom('supplier_payments').selectAll().where('credit_id', '=', creditId).where('voided_at', 'is', null).execute();
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
        vat_amount: bill.vatAmount ?? null,
        note: bill.note,
        created_by: bill.createdBy,
        kind: bill.kind ?? 'bill',
        credit_for_id: bill.creditForId ?? null,
        returns_stock: bill.returnsStock ?? false,
        prices_include_vat: bill.pricesIncludeVat ?? true,
        abroad: bill.abroad ?? false,
        customs_vat: bill.customs?.vat ?? null,
        customs_duty: bill.customs?.duty ?? null,
        customs_paid_method: bill.customs?.method ?? null,
        withholding_type: bill.withholdingType ?? null,
        withheld: bill.withheld ?? 0,
        paid_now: bill.paidNow ?? false,
        place: bill.place ?? 'shop',
        carwash_id: bill.carwashId ?? null,
        repeat_id: bill.repeatId ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  findLines(billIds: number[]): Promise<BillLineRecord[]> {
    if (billIds.length === 0) return Promise.resolve([]);
    return this.db
      .selectFrom('bill_lines as l')
      .leftJoin('products as p', 'p.id', 'l.product_id')
      .select([
        'l.id',
        'l.bill_id',
        'l.position',
        'l.kind',
        'l.product_id',
        'p.name as product_name',
        'l.quantity',
        'l.unit_price',
        'l.category',
        'l.description',
        'l.vat_rate',
        'l.vat_exempt',
        'l.net',
        'l.vat',
        'l.landed',
        'l.spread',
        'l.self_vat',
        'l.order_line_id',
      ])
      .where('l.bill_id', 'in', billIds)
      .orderBy('l.bill_id')
      .orderBy('l.position')
      .execute();
  }

  async addLines(billId: number, lines: NewBillLine[]): Promise<void> {
    if (lines.length === 0) return;
    await this.db
      .insertInto('bill_lines')
      .values(
        lines.map((line, index) => ({
          bill_id: billId,
          position: index + 1,
          kind: line.kind,
          product_id: line.productId,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          category: line.category,
          description: line.description,
          vat_rate: line.vatRate,
          vat_exempt: line.vatExempt,
          net: line.net,
          vat: line.vat,
          landed: line.landed,
          spread: line.spread,
          self_vat: line.selfVat,
          order_line_id: line.orderLineId,
        })),
      )
      .execute();
  }

  /** Learn a supplier's usual line, VAT and tax held back from the bill just saved. */
  async rememberForSupplier(
    supplierId: number,
    usual: { kind: BillLineKind; category: string | null; vatRate: number | null; vatExempt: boolean; withholdingType: WithholdingType | null },
  ): Promise<void> {
    await this.db
      .updateTable('suppliers')
      .set({ usual_kind: usual.kind, usual_category: usual.category, usual_vat_rate: usual.vatRate, usual_vat_exempt: usual.vatExempt, withholding_type: usual.withholdingType })
      .where('id', '=', supplierId)
      .execute();
  }

  async update(id: number, changes: { number: string | null; issuedOn: string; dueOn: string | null; amount: number; vatAmount?: number | null; note: string | null }) {
    await this.db
      .updateTable('supplier_bills')
      // A form that doesn't ask for the VAT leaves it as it was.
      .set({ number: changes.number, issued_on: changes.issuedOn, due_on: changes.dueOn, amount: changes.amount, vat_amount: changes.vatAmount, note: changes.note })
      .where('id', '=', id)
      .execute();
  }

  async setVatMonth(id: number, month: string | null): Promise<void> {
    await this.db.updateTable('supplier_bills').set({ vat_month: month }).where('id', '=', id).execute();
  }

  async setPhoto(id: number, mediaId: string | null): Promise<void> {
    await this.db.updateTable('supplier_bills').set({ photo_media_id: mediaId }).where('id', '=', id).execute();
  }

  /** Frees the order for a new bill (an order has one bill at most). */
  async detachOrder(id: number): Promise<void> {
    await this.db.updateTable('supplier_bills').set({ order_id: null }).where('id', '=', id).execute();
  }

  async void(id: number, by: number, note: string, at: Date): Promise<void> {
    await this.db.updateTable('supplier_bills').set({ voided_at: at, voided_by: by, void_note: note }).where('id', '=', id).execute();
  }

  async addPayment(payment: {
    billId: number;
    amount: number;
    paidOn: string;
    method: SupplierPaymentMethod;
    /** Where the money came from; null only for a credit. */
    placeId: number | null;
    groupId?: number | null;
    note: string | null;
    createdBy: number | null;
    creditId?: number | null;
  }) {
    const row = await this.db
      .insertInto('supplier_payments')
      .values({
        bill_id: payment.billId,
        amount: payment.amount,
        paid_on: payment.paidOn,
        method: payment.method,
        place_id: payment.placeId,
        group_id: payment.groupId ?? null,
        note: payment.note,
        created_by: payment.createdBy,
        credit_id: payment.creditId ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async voidPayment(id: number, by: number, at: Date): Promise<void> {
    await this.db.updateTable('supplier_payments').set({ voided_at: at, voided_by: by }).where('id', '=', id).execute();
  }

  /** Cash taken out of a till to pay suppliers, per till and day ("12|2026-10-09" -> euros). */
  async drawerPaymentsByDay(from: string, to: string): Promise<Map<string, number>> {
    const rows = await this.db
      .selectFrom('supplier_payments')
      .select([sql<string>`place_id || '|' || to_char(paid_on, 'YYYY-MM-DD')`.as('day'), sql<string>`sum(amount)`.as('total')])
      .where('method', '=', 'drawer')
      .where('voided_at', 'is', null)
      .where('paid_on', '>=', from)
      .where('paid_on', '<=', to)
      .groupBy(['place_id', 'paid_on'])
      .execute();
    return new Map(rows.map((row) => [row.day, Number(row.total)]));
  }

  /** Paid in a range of days, voided payments and credits left out. */
  async paidBetween(from: string, to: string): Promise<{ total: number; count: number }> {
    const row = await this.db
      .selectFrom('supplier_payments')
      .select([sql<string>`coalesce(sum(amount), 0)`.as('total'), sql<string>`count(*)`.as('count')])
      .where('voided_at', 'is', null)
      .where('method', '!=', 'credit')
      .where('paid_on', '>=', from)
      .where('paid_on', '<=', to)
      .executeTakeFirstOrThrow();
    return { total: Number(row.total), count: Number(row.count) };
  }

  // Repeating bills

  findActiveRepeats(): Promise<RepeatRecord[]> {
    return this.repeatQuery().where('r.stopped_at', 'is', null).orderBy('r.day_of_month').orderBy('r.id').execute();
  }

  findRepeat(id: number): Promise<RepeatRecord | undefined> {
    return this.repeatQuery().where('r.id', '=', id).executeTakeFirst();
  }

  private repeatQuery() {
    return this.db
      .selectFrom('bill_repeats as r')
      .leftJoin('users as u', 'u.id', 'r.created_by')
      .leftJoin('carwashes as w', 'w.id', 'r.carwash_id')
      .leftJoin('suppliers as s', 's.id', 'r.supplier_id')
      .select([
        'r.id',
        'r.supplier_id',
        's.name as supplier_name',
        'r.template',
        'r.amount',
        'r.category',
        'r.place',
        'r.carwash_id',
        'w.name as carwash_name',
        'r.note',
        'r.day_of_month',
        sql<string>`to_char(r.last_filled_on, 'YYYY-MM-DD')`.as('last_filled_on'),
        'r.stopped_at',
        'u.name as created_by_name',
      ]);
  }

  async addRepeat(rule: {
    supplierId: number | null;
    template: unknown;
    amount: number;
    category: string | null;
    place: ExpensePlace;
    carwashId: number | null;
    note: string | null;
    dayOfMonth: number;
    lastFilledOn: string;
    createdBy: number;
  }): Promise<number> {
    const row = await this.db
      .insertInto('bill_repeats')
      .values({
        supplier_id: rule.supplierId,
        template: JSON.stringify(rule.template),
        amount: rule.amount,
        category: rule.category,
        place: rule.place,
        carwash_id: rule.carwashId,
        note: rule.note,
        day_of_month: rule.dayOfMonth,
        last_filled_on: rule.lastFilledOn,
        created_by: rule.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async markRepeatFilled(id: number, day: string): Promise<void> {
    await this.db.updateTable('bill_repeats').set({ last_filled_on: day }).where('id', '=', id).execute();
  }

  async stopRepeat(id: number, at: Date): Promise<void> {
    await this.db.updateTable('bill_repeats').set({ stopped_at: at }).where('id', '=', id).execute();
  }

  /** A carwash that closes stops its monthly bills. Returns how many stopped. */
  async stopRepeatsForCarwash(carwashId: number, at: Date): Promise<number> {
    const result = await this.db
      .updateTable('bill_repeats')
      .set({ stopped_at: at })
      .where('carwash_id', '=', carwashId)
      .where('stopped_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  /** A repeat's bill already made for this day. */
  async findRepeatBill(repeatId: number, day: string): Promise<number | undefined> {
    const row = await this.db.selectFrom('supplier_bills').select('id').where('repeat_id', '=', repeatId).where('issued_on', '=', day).executeTakeFirst();
    return row?.id;
  }
}

export interface RepeatRecord {
  id: number;
  supplier_id: number | null;
  supplier_name: string | null;
  template: unknown;
  amount: string;
  category: string | null;
  place: ExpensePlace;
  carwash_id: number | null;
  carwash_name: string | null;
  note: string | null;
  day_of_month: number;
  /** The last day it made a bill for. */
  last_filled_on: string;
  stopped_at: Date | null;
  created_by_name: string | null;
}
