import { sql } from 'kysely';
import { WITHHOLDING_RATES, type WithholdingType } from '../../constants/bills.js';
import type { DatabaseClient } from '../../database/connection.js';
import type { DocumentParty, UserRole } from '../../database/types.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../errors/httpErrors.js';
import { ActivityLogRepository } from '../../repositories/ActivityLogRepository.js';
import { type VatMonthRecord, VatMonthRepository } from '../../repositories/VatMonthRepository.js';
import { roundMoney } from '../../utils/money.js';
import { canReopen } from '../../utils/roles.js';
import { zonedDay } from '../../utils/zonedDates.js';
import { BOOKS_START_KEY } from '../books/BooksPoster.js';
import { monthOf } from './periodLock.js';
import {
  addTo,
  asSupplierCredit,
  type Boxes,
  claimedVat,
  importBoxes,
  localPurchaseBoxes,
  saleBoxes,
  type VatItem,
  vatResult,
} from './vatReturn.js';

/** Cost categories that are not purchases (pay and taxes), left off the VAT return. */
const NOT_PURCHASES = new Set(['wages', 'taxes']);
/**
 * A purchase over this, paid in cash, is listed before filing: Kosovo's profit
 * tax rule says such a cost is not deductible unless paid through a bank.
 * Kept until the accountant says whether it still applies (handoff.md).
 */
export const CASH_LIMIT = 500;
/** The VAT return is due by this day of the next month. */
export const DUE_DAY = 20;

export type CheckKind = 'no_nui' | 'vat_mismatch' | 'cash_over_limit' | 'order_without_bill' | 'previous_open' | 'books_differ';

/** Something to look at before filing, with where to fix it. */
export interface VatCheck {
  kind: CheckKind;
  /** The dashboard page that fixes it. */
  to: string;
  /** Facts the dashboard words: names, numbers, amounts. */
  facts: Record<string, string | number | null>;
}

export interface Over500Row {
  billId: number;
  date: string;
  supplier: string | null;
  nui: string | null;
  number: string | null;
  total: number;
  bank: number;
  cash: number;
  unpaid: number;
}

export interface VatMonthDto {
  /** "2026-09". */
  month: string;
  status: 'open' | 'filed';
  filedAt: string | null;
  filedBy: string | null;
  /** The month is over, so it can be filed. */
  canFile: boolean;
  /** The day the return and any payment are due. */
  dueOn: string;
  boxes: Record<number, number>;
  outcome: 'pay' | 'carry' | 'nothing';
  /** Where box 68 came from: last month's return, typed by hand, or nothing (the first month). */
  carriedFrom: 'previous' | 'typed' | 'none';
  /** Box 70 as asked for (it is capped at box 69 in the return). */
  refundAsked: number;
  /** The first month 4VD keeps the books for; box 68 can be typed from here back. */
  firstMonth: string | null;
  items: VatItem[];
  checks: VatCheck[];
  over500: Over500Row[];
}

export interface VatYearRow {
  month: string;
  status: 'open' | 'filed' | 'future';
  sales: number;
  purchases: number;
  equipment: number;
  charged: number;
  claimable: number;
  difference: number;
  carriedIn: number;
  carriedOut: number;
  toPay: number;
}

export interface WithholdingRow {
  billId: number;
  date: string;
  supplier: string | null;
  nui: string | null;
  number: string | null;
  type: WithholdingType;
  rate: number;
  /** What the paper adds up to, before the tax held back. */
  gross: number;
  withheld: number;
}

/** What was filed, kept so the next month's credit never moves. */
interface FiledFigures {
  boxes: Record<number, number>;
  outcome: VatMonthDto['outcome'];
  carriedFrom: VatMonthDto['carriedFrom'];
}

const n = (value: string | number | null | undefined) => (value === null || value === undefined ? 0 : Number(value));

/** "2026-09" or "2026-09-01" → "2026-09-01". */
export const firstDay = (month: string) => `${month.slice(0, 7)}-01`;
export const addMonths = (month: string, count: number) => {
  const date = new Date(`${firstDay(month)}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 10);
};
const lastDay = (month: string) => {
  const date = new Date(`${addMonths(month, 1)}T00:00:00Z`);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
};
const short = (month: string) => month.slice(0, 7);

/**
 * The VAT month, worked out from the documents: the return (boxes 9-72), the
 * sales and purchase books, the checks before filing, filing and reopening
 * (which locks and unlocks everything dated in the month, see periodLock),
 * the tax held back, and the year at a glance.
 */
export class VatService {
  private readonly periods: VatMonthRepository;

  constructor(
    private readonly db: DatabaseClient,
    private readonly timeZone: string,
  ) {
    this.periods = new VatMonthRepository(db);
  }

  /** The first month 4VD keeps the books for; earlier months carry nothing in unless typed. */
  async firstMonth(): Promise<string | null> {
    const row = await this.db.selectFrom('settings').select('value').where('key', '=', BOOKS_START_KEY).executeTakeFirst();
    return typeof row?.value === 'string' ? monthOf(row.value) : null;
  }

  filedMonths(): Promise<string[]> {
    return this.periods.filedMonths().then((months) => months.map(short));
  }

  /** Every document in the month, as the return sees it, oldest first. */
  async items(month: string): Promise<VatItem[]> {
    const from = firstDay(month);
    const to = addMonths(month, 1);
    const [sales, returns, bills] = await Promise.all([this.saleItems(from, to), this.returnItems(from, to), this.billItems(from)]);
    return [...sales, ...returns, ...bills].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  }

  /**
   * Till sales as one line per day, sales invoiced to a named buyer as one
   * line per invoice. Every sale has an invoice in 4VD; one without a buyer is
   * a till sale. A line is dated by the sale, so a sale entered later for an
   * earlier day counts in that day's month. VAT is worked out per checkout and
   * rate, as the books post it.
   */
  private async saleItems(from: string, to: string): Promise<VatItem[]> {
    const tz = this.timeZone;
    const { rows } = await sql<{ day: string; invoice_id: number | null; checkout: string; rate: number; exempt: boolean; gross: string; sales: string }>`
      select x.day, x.invoice_id, x.checkout, x.rate, x.exempt, sum(x.total) as gross, count(*) as sales
      from (
        select (s.sale_date at time zone ${tz})::date::text as day, s.total_amount as total,
          coalesce(dl.vat_rate, p.vat_rate) as rate, coalesce(dl.vat_exempt, p.vat_exempt) as exempt, inv.id as invoice_id,
          coalesce('i' || inv.id, 'r' || s.receipt_no || '@' || (s.sale_date at time zone ${tz})::date::text, 's' || s.id) as checkout
        from sales s
        join products p on p.id = s.product_id
        left join lateral (select l.vat_rate, l.vat_exempt from document_lines l where l.sale_id = s.id order by l.id desc limit 1) dl on true
        left join lateral (
          select d.id from document_lines l join documents d on d.id = l.document_id
          where l.sale_id = s.id and d.kind = 'invoice' order by d.id desc limit 1
        ) inv on true
        where s.sale_date >= (${from}::date::timestamp at time zone ${tz}) and s.sale_date < (${to}::date::timestamp at time zone ${tz})
          and s.undone_at is null
      ) x
      group by x.day, x.invoice_id, x.checkout, x.rate, x.exempt
    `.execute(this.db);

    const invoiceIds = [...new Set(rows.flatMap((row) => (row.invoice_id === null ? [] : [row.invoice_id])))];
    const invoices = new Map(
      (invoiceIds.length === 0
        ? []
        : await this.db
            .selectFrom('documents')
            .select(['id', 'number', 'buyer', sql<string>`(issued_at at time zone ${tz})::date::text`.as('day')])
            .where('id', 'in', invoiceIds)
            .execute()
      ).map((doc) => [doc.id, doc]),
    );

    const byKey = new Map<string, VatItem>();
    for (const row of rows) {
      const doc = row.invoice_id === null ? undefined : invoices.get(row.invoice_id);
      const buyer = (doc?.buyer ?? null) as DocumentParty | null;
      const named = Boolean(buyer?.name);
      const key = named ? `invoice:${row.invoice_id}` : `day:${row.day}`;
      let item = byKey.get(key);
      if (!item) {
        if (!named) {
          item = { kind: 'till_day', ref: row.day, date: row.day, number: null, party: null, nui: null, boxes: {}, count: 0 };
        } else {
          item = { kind: 'invoice', ref: String(row.invoice_id), date: row.day, number: doc?.number ?? null, party: buyer?.name ?? null, nui: buyer?.nui ?? null, boxes: {}, count: 0 };
        }
        byKey.set(key, item);
      }
      saleBoxes(item.boxes, n(row.gross), row.rate, row.exempt, 1);
      item.count! += Number(row.sales);
    }
    return [...byKey.values()];
  }

  /** Approved refunds to customers: credit notes the shop issued, on the day they were approved (as the books post them). */
  private async returnItems(from: string, to: string): Promise<VatItem[]> {
    const tz = this.timeZone;
    const { rows } = await sql<{ id: number; day: string; refund: string; quantity: number; product: string; rate: number; exempt: boolean; customer: string | null; nui: string | null }>`
      select r.id, (r.decided_at at time zone ${tz})::date::text as day, r.refund_amount as refund, r.quantity, p.name as product,
        coalesce((select l.vat_rate from document_lines l where l.sale_id = s.id order by l.id desc limit 1), p.vat_rate) as rate,
        coalesce((select l.vat_exempt from document_lines l where l.sale_id = s.id order by l.id desc limit 1), p.vat_exempt) as exempt,
        c.name as customer, c.nui
      from returns r
      join sales s on s.id = r.sale_id
      join products p on p.id = s.product_id
      left join lateral (select t.customer_id from tab_entries t where t.return_id = r.id limit 1) t on true
      left join customers c on c.id = t.customer_id
      where r.status = 'approved' and r.undone_at is null and r.decided_at is not null
        and r.decided_at >= (${from}::date::timestamp at time zone ${tz}) and r.decided_at < (${to}::date::timestamp at time zone ${tz})
    `.execute(this.db);
    return rows.map((row) => {
      const boxes: Boxes = {};
      saleBoxes(boxes, n(row.refund), row.rate, row.exempt, -1);
      return { kind: 'return', ref: String(row.id), date: row.day, number: `${row.quantity} × ${row.product}`, party: row.customer, nui: row.nui, boxes, count: row.quantity };
    });
  }

  /** Supplier bills, returns and credits counted in the month (a late bill counts in the next open month). Carwash bills stay out, as in the books. */
  private async billItems(month: string): Promise<VatItem[]> {
    const bills = await this.db
      .selectFrom('supplier_bills as b')
      .leftJoin('suppliers as s', 's.id', 'b.supplier_id')
      .select([
        'b.id',
        'b.kind',
        'b.number',
        'b.amount',
        'b.vat_amount',
        'b.withheld',
        'b.abroad',
        'b.customs_vat',
        'b.note',
        's.name',
        's.nui',
        sql<string>`to_char(b.issued_on, 'YYYY-MM-DD')`.as('issued_on'),
        sql<string | null>`to_char(b.vat_month, 'YYYY-MM-DD')`.as('vat_month'),
      ])
      .where(sql<boolean>`coalesce(b.vat_month, date_trunc('month', b.issued_on)::date) = ${month}::date`)
      .where('b.voided_at', 'is', null)
      .where('b.place', '<>', 'carwash')
      // Open bills from TREFIN were in TREFIN's returns already.
      .where('b.brought_over', '=', false)
      .execute();
    if (bills.length === 0) return [];
    const lines = await this.db
      .selectFrom('bill_lines as l')
      .leftJoin('products as p', 'p.id', 'l.product_id')
      .select(['l.bill_id', 'l.kind', 'l.category', 'l.vat_rate', 'l.net', 'l.vat', 'l.landed', 'l.spread', 'l.self_vat', 'l.order_line_id', 'p.vat_rate as product_rate'])
      .where('l.bill_id', 'in', bills.map((bill) => bill.id))
      .orderBy('l.bill_id')
      .orderBy('l.position')
      .execute();
    const linesOf = new Map<number, typeof lines>();
    for (const line of lines) linesOf.set(line.bill_id, [...(linesOf.get(line.bill_id) ?? []), line]);

    return bills.map((bill) => {
      const purchase = billBoxes(bill, linesOf.get(bill.id) ?? []);
      return {
        kind: bill.kind === 'credit' ? 'credit' : 'bill',
        ref: String(bill.id),
        date: bill.issued_on,
        number: bill.number,
        party: bill.name ?? bill.note,
        nui: bill.nui,
        boxes: bill.kind === 'credit' ? asSupplierCredit(purchase) : purchase,
        ...(bill.vat_month !== null && bill.vat_month !== monthOf(bill.issued_on) && { lateFrom: short(monthOf(bill.issued_on)) }),
      } satisfies VatItem;
    });
  }

  /**
   * Box 68 for a month: what the month before carried on (as filed, or worked
   * out), or what was typed for the first month. Walks back to the first
   * month of the books at most.
   */
  private async carriedInto(month: string, rows: Map<string, VatMonthRecord>, first: string | null): Promise<{ amount: number; from: VatMonthDto['carriedFrom'] }> {
    const own = rows.get(month);
    if (own?.carried_in !== null && own?.carried_in !== undefined) return { amount: n(own.carried_in), from: 'typed' };
    if (first === null || month <= first) return { amount: 0, from: 'none' };
    const previous = addMonths(month, -1);
    const before = rows.get(previous);
    if (before?.figures) return { amount: (before.figures as FiledFigures).boxes[71] ?? 0, from: 'previous' };
    const figures = await this.figures(previous, rows, first);
    return { amount: figures.result.boxes[71] ?? 0, from: 'previous' };
  }

  private async figures(month: string, rows: Map<string, VatMonthRecord>, first: string | null) {
    const items = await this.items(month);
    const carried = await this.carriedInto(month, rows, first);
    const record = rows.get(month);
    return { items, carried, result: vatResult(items, carried.amount, n(record?.refund)) };
  }

  private async monthRows(until: string): Promise<{ rows: Map<string, VatMonthRecord>; first: string | null }> {
    const first = await this.firstMonth();
    const records = await this.periods.between(first && first < until ? addMonths(first, -1) : addMonths(until, -1), until);
    return { rows: new Map(records.map((record) => [record.month, record])), first };
  }

  /** The return for a month, with its documents, the checks and the purchases over €500. */
  async month(monthKey: string, now = new Date()): Promise<VatMonthDto> {
    const month = firstDay(monthKey);
    const { rows, first } = await this.monthRows(month);
    const record = rows.get(month);
    const { items, carried, result } = await this.figures(month, rows, first);
    const filed = record?.figures ? (record.figures as FiledFigures) : null;
    const [checks, over500] = await Promise.all([this.checks(month, items, result.boxes, rows, first), this.over500(month)]);
    return {
      month: short(month),
      status: record?.filed_at ? 'filed' : 'open',
      filedAt: record?.filed_at?.toISOString() ?? null,
      filedBy: record?.filed_by_name ?? null,
      canFile: zonedDay(now, this.timeZone) > lastDay(month),
      dueOn: `${short(addMonths(month, 1))}-${DUE_DAY}`,
      // A filed month shows what was filed; its documents can't change anyway.
      boxes: filed?.boxes ?? result.boxes,
      outcome: filed?.outcome ?? result.outcome,
      carriedFrom: filed?.carriedFrom ?? carried.from,
      refundAsked: n(record?.refund),
      firstMonth: first && short(first),
      items,
      checks,
      over500,
    };
  }

  /** What to look at before filing; each links to where it is fixed. */
  private async checks(month: string, items: VatItem[], boxes: Record<number, number>, rows: Map<string, VatMonthRecord>, first: string | null): Promise<VatCheck[]> {
    const checks: VatCheck[] = [];
    const billIds = items.filter((item) => item.kind === 'bill').map((item) => Number(item.ref));

    if (first !== null && month > first && !rows.get(addMonths(month, -1))?.filed_at) {
      checks.push({ kind: 'previous_open', to: `/books/vat?month=${short(addMonths(month, -1))}`, facts: { month: short(addMonths(month, -1)) } });
    }

    if (billIds.length > 0) {
      // VAT can only be claimed on a bill from a supplier with an NUI (suppliers abroad have none in Kosovo).
      const bills = await this.db
        .selectFrom('supplier_bills as b')
        .leftJoin('suppliers as s', 's.id', 'b.supplier_id')
        .select(['b.id', 'b.number', 'b.supplier_id', 's.name', 's.nui', 'b.abroad'])
        .where('b.id', 'in', billIds)
        .execute();
      const claimed = new Map(items.filter((item) => item.kind === 'bill').map((item) => [Number(item.ref), claimedVat(item)]));
      for (const bill of bills) {
        if (bill.abroad || (claimed.get(bill.id) ?? 0) <= 0 || (bill.nui ?? '').trim() !== '') continue;
        checks.push({
          kind: 'no_nui',
          to: bill.supplier_id ? `/suppliers/${bill.supplier_id}` : `/bills/${bill.id}`,
          facts: { billId: bill.id, number: bill.number, supplier: bill.name, vat: claimed.get(bill.id) ?? 0 },
        });
      }

      // A line whose VAT isn't its rate of its amount (typed by hand, or read wrong from a scan).
      const lines = await this.db
        .selectFrom('bill_lines as l')
        .innerJoin('supplier_bills as b', 'b.id', 'l.bill_id')
        .leftJoin('suppliers as s', 's.id', 'b.supplier_id')
        .select(['l.bill_id', 'l.position', 'l.vat_rate', 'l.net', 'l.vat', 'b.number', 's.name'])
        .where('l.bill_id', 'in', billIds)
        .where('b.abroad', '=', false)
        .execute();
      for (const line of lines) {
        const expected = roundMoney((n(line.net) * line.vat_rate) / 100);
        if (Math.abs(expected - n(line.vat)) <= 0.02) continue;
        checks.push({
          kind: 'vat_mismatch',
          to: `/bills/${line.bill_id}`,
          facts: { billId: line.bill_id, number: line.number, supplier: line.name, line: line.position, rate: line.vat_rate, vat: n(line.vat), expected },
        });
      }
      // A bill typed as a total whose VAT is no rate of what's left.
      const totals = await this.db
        .selectFrom('supplier_bills as b')
        .leftJoin('suppliers as s', 's.id', 'b.supplier_id')
        .select(['b.id', 'b.number', 'b.amount', 'b.withheld', 'b.vat_amount', 's.name'])
        .where('b.id', 'in', billIds)
        .where('b.vat_amount', 'is not', null)
        .where('b.abroad', '=', false)
        .where((eb) => eb.not(eb.exists(eb.selectFrom('bill_lines as l').select('l.id').whereRef('l.bill_id', '=', 'b.id'))))
        .execute();
      for (const bill of totals) {
        const vat = n(bill.vat_amount);
        const net = roundMoney(n(bill.amount) + n(bill.withheld) - vat);
        if (vat === 0 || net <= 0) continue;
        const rate = (vat / net) * 100;
        if ([18, 16, 8].some((candidate) => Math.abs(rate - candidate) < 0.3)) continue;
        checks.push({ kind: 'vat_mismatch', to: `/bills/${bill.id}`, facts: { billId: bill.id, number: bill.number, supplier: bill.name, line: null, rate: Math.round(rate * 10) / 10, vat, expected: null } });
      }
    }

    for (const row of await this.over500(month)) {
      if (row.cash <= 0) continue;
      checks.push({ kind: 'cash_over_limit', to: `/bills/${row.billId}`, facts: { billId: row.billId, number: row.number, supplier: row.supplier, total: row.total, cash: row.cash } });
    }

    // Goods that came in by the month's end with no bill yet: their VAT is missing from the return.
    const end = lastDay(month);
    const orders = await this.db
      .selectFrom('purchase_orders as o')
      .innerJoin('suppliers as s', 's.id', 'o.supplier_id')
      .select(['o.id', 's.name', sql<string>`(o.closed_at at time zone ${this.timeZone})::date::text`.as('received')])
      .where('o.status', '=', 'received')
      .where(sql<boolean>`(o.closed_at at time zone ${this.timeZone})::date <= ${end}::date`)
      .where((eb) => eb.not(eb.exists(eb.selectFrom('supplier_bills as b').select('b.id').whereRef('b.order_id', '=', 'o.id').where('b.voided_at', 'is', null))))
      .orderBy('o.closed_at')
      .execute();
    for (const order of orders) {
      checks.push({ kind: 'order_without_bill', to: `/orders/${order.id}`, facts: { orderId: order.id, supplier: order.name, received: order.received } });
    }

    // The books should agree: VAT owed (2340) less VAT to claim (1260) moved by what the return says is due.
    if (first !== null && month >= first) {
      const books = await this.booksVat(month);
      const returnDue = roundMoney(boxes[30]! - boxes[67]!);
      if (books !== null && Math.abs(books - returnDue) > 0.05) {
        checks.push({ kind: 'books_differ', to: `/books?period=custom&from=${month}&to=${end}`, facts: { books, vat: returnDue } });
      }
    }
    return checks;
  }

  /** What VAT owed less VAT to claim moved in the books in the month; null when the accounts aren't linked. */
  private async booksVat(month: string): Promise<number | null> {
    const links = await this.db.selectFrom('ledger_links').select(['key', 'account_id']).where('key', 'in', ['vat_out', 'vat_in']).execute();
    const out = links.find((link) => link.key === 'vat_out')?.account_id;
    const into = links.find((link) => link.key === 'vat_in')?.account_id;
    if (out === undefined || into === undefined) return null;
    const row = await this.db
      .selectFrom('ledger_lines as l')
      .innerJoin('ledger_entries as e', 'e.id', 'l.entry_id')
      .select([
        sql<string>`coalesce(sum(case when l.account_id = ${out} then l.credit - l.debit else 0 end), 0)`.as('owed'),
        sql<string>`coalesce(sum(case when l.account_id = ${into} then l.debit - l.credit else 0 end), 0)`.as('claimed'),
      ])
      .where('e.entry_date', '>=', month)
      .where('e.entry_date', '<=', lastDay(month))
      .where('l.account_id', 'in', [out, into])
      .executeTakeFirstOrThrow();
    return roundMoney(n(row.owed) - n(row.claimed));
  }

  /** Bills over €500 in the month, with how they were paid (TREFIN's "purchases over 500 euro"). */
  async over500(monthKey: string): Promise<Over500Row[]> {
    const month = firstDay(monthKey);
    const { rows } = await sql<{ id: number; day: string; name: string | null; note: string | null; nui: string | null; number: string | null; total: string; bank: string; cash: string }>`
      select b.id, to_char(b.issued_on, 'YYYY-MM-DD') as day, s.name, b.note, s.nui, b.number, b.amount + b.withheld as total,
        coalesce((select sum(p.amount) from supplier_payments p where p.bill_id = b.id and p.voided_at is null and p.method = 'bank'), 0) as bank,
        coalesce((select sum(p.amount) from supplier_payments p where p.bill_id = b.id and p.voided_at is null and p.method in ('cash', 'drawer')), 0) as cash
      from supplier_bills b
      left join suppliers s on s.id = b.supplier_id
      where coalesce(b.vat_month, date_trunc('month', b.issued_on)::date) = ${month}::date
        and b.voided_at is null and b.kind = 'bill' and b.amount + b.withheld > ${CASH_LIMIT}
      order by b.issued_on, b.id
    `.execute(this.db);
    return rows.map((row) => {
      const total = n(row.total);
      const bank = n(row.bank);
      const cash = n(row.cash);
      return { billId: row.id, date: row.day, supplier: row.name ?? row.note, nui: row.nui, number: row.number, total, bank, cash, unpaid: roundMoney(Math.max(total - bank - cash, 0)) };
    });
  }

  /** Tax held back from suppliers in the month (by the bill's date), for ATK's monthly withholding form. */
  async withholding(monthKey: string): Promise<WithholdingRow[]> {
    const month = firstDay(monthKey);
    const rows = await this.db
      .selectFrom('supplier_bills as b')
      .leftJoin('suppliers as s', 's.id', 'b.supplier_id')
      .select(['b.id', 'b.number', 'b.amount', 'b.withheld', 'b.withholding_type', 's.name', 's.nui', sql<string>`to_char(b.issued_on, 'YYYY-MM-DD')`.as('day')])
      .where('b.issued_on', '>=', month)
      .where('b.issued_on', '<=', lastDay(month))
      .where('b.voided_at', 'is', null)
      .where('b.kind', '=', 'bill')
      .where('b.withheld', '>', '0')
      .orderBy('b.issued_on')
      .orderBy('b.id')
      .execute();
    return rows.map((row) => {
      const type = row.withholding_type ?? 'special';
      return {
        billId: row.id,
        date: row.day,
        supplier: row.name,
        nui: row.nui,
        number: row.number,
        type,
        rate: WITHHOLDING_RATES[type],
        gross: roundMoney(n(row.amount) + n(row.withheld)),
        withheld: n(row.withheld),
      };
    });
  }

  /** One row per month of the year, up to this month: sales, purchases, VAT each way and the credit carried. */
  async year(year: number, now = new Date()): Promise<VatYearRow[]> {
    const thisMonth = monthOf(zonedDay(now, this.timeZone));
    const last = `${year}-12-01`;
    const { rows, first } = await this.monthRows(last < thisMonth ? last : thisMonth);
    const result: VatYearRow[] = [];
    let carried: number | null = null;
    for (let index = 0; index < 12; index += 1) {
      const month = `${year}-${String(index + 1).padStart(2, '0')}-01`;
      if (month > thisMonth) {
        result.push({ month: short(month), status: 'future', sales: 0, purchases: 0, equipment: 0, charged: 0, claimable: 0, difference: 0, carriedIn: 0, carriedOut: 0, toPay: 0 });
        continue;
      }
      const record = rows.get(month);
      let boxes: Record<number, number>;
      if (record?.figures) boxes = (record.figures as FiledFigures).boxes;
      else {
        const items = await this.items(month);
        const typed = record?.carried_in;
        const carriedIn =
          typed !== null && typed !== undefined
            ? n(typed)
            : first === null || month <= first
              ? 0
              : (carried ?? (await this.carriedInto(month, rows, first)).amount);
        boxes = vatResult(items, carriedIn, n(record?.refund)).boxes;
      }
      carried = boxes[71]!;
      const sum = (list: number[]) => roundMoney(list.reduce((total, box) => total + boxes[box]!, 0));
      result.push({
        month: short(month),
        status: record?.filed_at ? 'filed' : 'open',
        sales: sum([9, 10, 11, 12, 14]),
        purchases: sum([31, 35, 37, 43, 45, 51]),
        equipment: sum([32, 39, 41, 47, 49]),
        charged: boxes[30]!,
        claimable: boxes[67]!,
        difference: roundMoney(boxes[30]! - boxes[67]!),
        carriedIn: boxes[68]!,
        carriedOut: boxes[71]!,
        toPay: boxes[72]!,
      });
    }
    return result;
  }

  /** Box 70 (refund asked for) and box 68 typed by hand; not on a filed month. */
  async saveTyped(monthKey: string, values: { refund?: number; carriedIn?: number | null }, actorId: number): Promise<VatMonthDto> {
    const month = firstDay(monthKey);
    const record = await this.periods.find(month);
    if (record?.filed_at) throw new ConflictError('This month is filed. Reopen it to change its figures.');
    if (values.carriedIn !== undefined && values.carriedIn !== null) {
      const first = await this.firstMonth();
      if (first !== null && month > first) {
        throw new ValidationError('The credit carried in comes from last month\'s return here. It can only be typed for the first month 4VD keeps the books for.');
      }
    }
    if (values.refund !== undefined && values.refund > 0) {
      const current = await this.month(monthKey);
      const credit = roundMoney(current.boxes[67]! + (values.carriedIn ?? current.boxes[68]!) - current.boxes[30]!);
      if (values.refund > Math.max(credit, 0)) {
        throw new ValidationError(credit > 0 ? `A refund can be at most the credit, €${credit.toFixed(2)}.` : 'There is no credit this month to ask back.');
      }
    }
    await this.periods.saveTyped(month, values, actorId);
    return this.month(monthKey);
  }

  /** Mark the month as filed with ATK: its return is kept as it is now, and nothing dated in it can change. */
  async file(monthKey: string, actorId: number, now = new Date()): Promise<VatMonthDto> {
    const month = firstDay(monthKey);
    const current = await this.month(monthKey, now);
    if (current.status === 'filed') throw new ConflictError('This month is already filed');
    if (!current.canFile) throw new ConflictError('A month can be filed once it is over');
    const figures: FiledFigures = { boxes: current.boxes, outcome: current.outcome, carriedFrom: current.carriedFrom };
    await this.db.transaction().execute(async (trx) => {
      await new VatMonthRepository(trx).file(month, figures, actorId);
      await new ActivityLogRepository(trx).create({
        userId: actorId,
        action: 'vat.filed',
        entityType: 'vat_month',
        entityId: Number(month.slice(0, 4)) * 100 + Number(month.slice(5, 7)),
        say: { key: 'vatFiled', params: { month: short(month), outcome: current.outcome, amount: current.outcome === 'pay' ? current.boxes[72]! : current.boxes[71]! } },
        details: { boxes: current.boxes },
      });
    });
    return this.month(monthKey, now);
  }

  /** Open a filed month again, so its documents can be corrected. The accountant or the owner, with a reason. */
  async reopen(monthKey: string, reason: string, actor: { id: number; role: UserRole }, now = new Date()): Promise<VatMonthDto> {
    if (!canReopen(actor.role)) throw new ForbiddenError('Only the accountant or the owner can reopen a filed month');
    const month = firstDay(monthKey);
    const why = reason.trim();
    if (why.length < 3) throw new ValidationError('Say why the month is being reopened, so the books keep the reason');
    const record = await this.periods.find(month);
    const filedAt = record?.filed_at;
    if (!record || !filedAt) throw new ConflictError('This month is not filed');
    await this.db.transaction().execute(async (trx) => {
      await new VatMonthRepository(trx).reopen(month, actor.id);
      await new ActivityLogRepository(trx).create({
        userId: actor.id,
        action: 'vat.reopened',
        entityType: 'vat_month',
        entityId: Number(month.slice(0, 4)) * 100 + Number(month.slice(5, 7)),
        say: { key: 'vatReopened', params: { month: short(month), reason: why } },
        details: { reason: why, filedAt: filedAt.toISOString(), filedBy: record.filed_by_name, boxes: (record.figures as FiledFigures | null)?.boxes ?? null },
      });
    });
    return this.month(monthKey, now);
  }

  /** Every filed month, "2026-09", for the stamps in the books. */
  async filed(): Promise<string[]> {
    return (await this.periods.filedMonths()).map(short);
  }

  /** The shop's name and NUI, for the head of a printed book. */
  async business(): Promise<{ name: string; nui: string | null }> {
    const row = await this.db.selectFrom('businesses').select(['name', 'nui']).orderBy('id').executeTakeFirst();
    return { name: row?.name ?? '4VD', nui: row?.nui ?? null };
  }

  /** Months over and not filed, from the first month of the books: each one is a To do until filed. */
  async unfiled(now = new Date()): Promise<string[]> {
    const first = await this.firstMonth();
    if (first === null) return [];
    const thisMonth = monthOf(zonedDay(now, this.timeZone));
    if (first >= thisMonth) return [];
    const filed = new Set(await this.periods.filedMonths());
    const months: string[] = [];
    for (let month = first; month < thisMonth; month = addMonths(month, 1)) if (!filed.has(month)) months.push(short(month));
    return months;
  }
}

type BillRow = {
  kind: string;
  amount: string;
  vat_amount: string | null;
  withheld: string;
  abroad: boolean;
  customs_vat: string | null;
};
type LineRow = {
  kind: string;
  category: string | null;
  vat_rate: number;
  net: string;
  vat: string;
  landed: string;
  spread: boolean;
  self_vat: string;
  order_line_id: number | null;
  product_rate: number | null;
};

/** A bill's boxes as a purchase (a return or credit is turned round by `asSupplierCredit`). */
export function billBoxes(bill: BillRow, lines: LineRow[]): Boxes {
  const boxes: Boxes = {};
  const counted = lines.filter((line) => !(line.kind === 'cost' && line.category !== null && NOT_PURCHASES.has(line.category)));

  if (lines.length === 0) {
    // Typed as a total, before bills had lines: all of it is goods, at the rate its VAT suggests.
    const vat = n(bill.vat_amount);
    const net = roundMoney(n(bill.amount) + n(bill.withheld) - vat);
    const rate = vat === 0 || net <= 0 ? 0 : Math.abs((vat / net) * 100 - 8) < Math.abs((vat / net) * 100 - 18) ? 8 : 18;
    localPurchaseBoxes(boxes, net, vat, rate, false);
    return boxes;
  }

  if (bill.abroad) {
    // Goods carry the duty and transport in their value; the customs VAT is spread over them by value and rate.
    const goods = counted.filter((line) => line.kind !== 'cost');
    const customsVat = n(bill.customs_vat);
    const rateOf = (line: LineRow) => (line.kind === 'product' ? (line.product_rate ?? 18) : 18);
    const weights = goods.map((line) => n(line.landed) * rateOf(line));
    const weight = weights.reduce((sum, value) => sum + value, 0);
    let left = customsVat;
    goods.forEach((line, index) => {
      const share = index === goods.length - 1 ? roundMoney(left) : weight > 0 ? roundMoney((customsVat * weights[index]!) / weight) : 0;
      left = roundMoney(left - share);
      importBoxes(boxes, n(line.landed), share, rateOf(line), line.kind === 'equipment');
    });
    for (const line of counted.filter((candidate) => candidate.kind === 'cost' && !candidate.spread)) {
      const selfVat = n(line.self_vat);
      if (selfVat > 0) {
        addTo(boxes, 28, n(line.net));
        addTo(boxes, 29, selfVat);
        addTo(boxes, 65, n(line.net));
        addTo(boxes, 66, selfVat);
      } else addTo(boxes, 31, n(line.net));
    }
    return boxes;
  }

  // From a delivery, the paper's total wins over its lines' prices (as the books post it).
  const products = counted.filter((line) => line.kind === 'product');
  const fromDelivery = products.some((line) => line.order_line_id !== null);
  let scaleNet = 1;
  let scaleVat = 1;
  if (fromDelivery) {
    const others = lines.filter((line) => line.kind !== 'product');
    const othersGross = others.reduce((sum, line) => sum + n(line.net) + n(line.vat), 0);
    const othersVat = others.reduce((sum, line) => sum + n(line.vat), 0);
    const productsGross = roundMoney(n(bill.amount) + n(bill.withheld) - othersGross);
    const linesGross = products.reduce((sum, line) => sum + n(line.net) + n(line.vat), 0);
    const linesVat = products.reduce((sum, line) => sum + n(line.vat), 0);
    const productsVat = bill.vat_amount !== null ? roundMoney(n(bill.vat_amount) - othersVat) : linesGross > 0 ? roundMoney((productsGross * linesVat) / linesGross) : 0;
    const linesNet = linesGross - linesVat;
    scaleNet = linesNet > 0 ? (productsGross - productsVat) / linesNet : 1;
    scaleVat = linesVat > 0 ? productsVat / linesVat : 1;
  }
  for (const line of counted) {
    const scaled = fromDelivery && line.kind === 'product';
    const net = scaled ? roundMoney(n(line.net) * scaleNet) : n(line.net);
    const vat = scaled ? roundMoney(n(line.vat) * scaleVat) : n(line.vat);
    localPurchaseBoxes(boxes, line.kind === 'equipment' ? n(line.landed) : net, vat, line.vat_rate, line.kind === 'equipment');
  }
  return boxes;
}
