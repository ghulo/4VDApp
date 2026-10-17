import { sql } from 'kysely';
import type { DatabaseClient } from '../../database/connection.js';
import { roundMoney } from '../../utils/money.js';
import type { AccountLinkKey } from '../../constants/chartOfAccounts.js';
import { type AccountLinks, type DraftEntry, EntryBuilder, vatOf } from './entryBuilder.js';

/**
 * How each document posts, in plain terms (account numbers are TREFIN's defaults,
 * each one changeable under Books → Settings):
 *
 * - Sale (one entry per checkout): cash 1110, or the customer's receivable 1230
 *   for what went on their tab, against revenue 4000 and VAT owed 2340. Its cost
 *   moves from stock 1340 to cost of goods 5000.
 * - Return: revenue back through sales returns 4200 and VAT 2340, against the
 *   cash paid out or the tab; its cost goes back into stock.
 * - Supplier bill, by its lines: products to stock 1340, costs to their
 *   category's expense account (6xxx), equipment to its fixed-asset account
 *   (16xx-19xx) and the VAT to claim back to 1260, against what's owed to the
 *   supplier 2000 and any tax held back for ATK 2370. An import adds the customs
 *   VAT (1260) and the duty (onto the goods, with the transport), paid at the
 *   border from bank 1120 or cash 1110, and VAT charged to yourself on services
 *   from abroad both ways (1260 against 2340). A return or credit posts its
 *   lines the other way round. Paying a bill: 2000 against cash 1110 or bank
 *   1120; a credit applied to it posts nothing more. An expense is a bill paid
 *   on the spot. Carwash-only bills are left out until the accountant says how
 *   the carwash is booked.
 * - Customer paying their tab: cash 1110 against 1230.
 * - Write-off, count difference, manual stock correction: stock corrections
 *   5400 against stock 1340, at cost.
 *
 * Prices and costs in 4VD include VAT; the VAT part is split off by the rate.
 */

export type SourceKind = 'checkout' | 'return' | 'write_off' | 'count_line' | 'adjustment' | 'bill' | 'payment' | 'expense' | 'tab_payment';

/** A sale's checkout, the same grouping the Sales page shows: its invoice, else its TREFIN receipt and day, else the sale alone. */
export const checkoutKeySql = (timeZone: string) => sql<string>`coalesce(
  'i' || (select d.id from document_lines dl join documents d on d.id = dl.document_id
          where dl.sale_id = s.id and d.kind = 'invoice' order by d.id desc limit 1),
  'r' || s.receipt_no || '@' || (s.sale_date at time zone ${timeZone})::date::text,
  's' || s.id
)`;

const zonedDaySql = (column: ReturnType<typeof sql.ref>, timeZone: string) => sql<string>`(${column} at time zone ${timeZone})::date::text`;

const n = (value: string | number | null | undefined) => (value === null || value === undefined ? null : Number(value));

export class PostingRules {
  constructor(
    private readonly db: DatabaseClient,
    private readonly links: AccountLinks,
    private readonly timeZone: string,
    /** The books' first day; documents before it post nothing. Null: no limit. */
    private readonly startDay: string | null,
  ) {}

  private builder() {
    return new EntryBuilder(this.links);
  }

  private tooEarly(day: string): boolean {
    return this.startDay !== null && day < this.startDay;
  }

  async draft(sourceKey: string): Promise<DraftEntry | null> {
    const at = sourceKey.indexOf(':');
    const kind = sourceKey.slice(0, at) as SourceKind;
    const ref = sourceKey.slice(at + 1);
    switch (kind) {
      case 'checkout':
        return this.checkout(ref);
      case 'return':
        return this.saleReturn(Number(ref));
      case 'write_off':
        return this.writeOff(Number(ref));
      case 'count_line':
        return this.countLine(Number(ref));
      case 'adjustment':
        return this.adjustment(Number(ref));
      case 'bill':
        return this.bill(Number(ref));
      case 'payment':
        return this.payment(Number(ref));
      case 'expense':
        return this.expense(Number(ref));
      case 'tab_payment':
        return this.tabPayment(Number(ref));
      default:
        throw new Error(`Unknown source ${sourceKey}`);
    }
  }

  private async checkout(key: string): Promise<DraftEntry | null> {
    const tz = this.timeZone;
    const narrow =
      key[0] === 'i'
        ? sql`s.id in (select sale_id from document_lines where document_id = ${Number(key.slice(1))})`
        : key[0] === 'r'
          ? sql`s.receipt_no = ${key.slice(1, key.lastIndexOf('@'))}`
          : sql`s.id = ${Number(key.slice(1))}`;
    const { rows } = await sql<{
      id: number;
      day: string;
      quantity: number;
      total: string;
      unit_cost: string | null;
      vat_rate: number;
      product_name: string;
      receipt_no: string | null;
      charged: string;
      customer_id: number | null;
    }>`
      select s.id, ${zonedDaySql(sql.ref('s.sale_date'), tz)} as day, s.quantity_sold as quantity, s.total_amount as total,
        s.unit_cost, p.name as product_name, s.receipt_no,
        coalesce((select dl.vat_rate from document_lines dl where dl.sale_id = s.id order by dl.id desc limit 1), p.vat_rate) as vat_rate,
        coalesce((select sum(t.amount) from tab_entries t where t.sale_id = s.id and t.kind = 'charge'), 0) as charged,
        (select t.customer_id from tab_entries t where t.sale_id = s.id and t.kind = 'charge' limit 1) as customer_id
      from sales s join products p on p.id = s.product_id
      where ${narrow} and s.undone_at is null and ${checkoutKeySql(tz)} = ${key}
      order by s.sale_date, s.id
    `.execute(this.db);
    if (rows.length === 0) return null;
    const day = rows.reduce((first, row) => (row.day < first ? row.day : first), rows[0]!.day);
    if (this.tooEarly(day)) return null;

    const entry = this.builder();
    const grossByRate = new Map<number, number>();
    let cost = 0;
    let withoutCost = 0;
    for (const row of rows) {
      grossByRate.set(row.vat_rate, roundMoney((grossByRate.get(row.vat_rate) ?? 0) + Number(row.total)));
      if (row.unit_cost === null) withoutCost += 1;
      else cost += row.quantity * Number(row.unit_cost);
      if (Number(row.charged) > 0) entry.debit('receivables', Number(row.charged), { customerId: row.customer_id });
    }
    const gross = roundMoney([...grossByRate.values()].reduce((sum, value) => sum + value, 0));
    const charged = roundMoney(rows.reduce((sum, row) => sum + Number(row.charged), 0));
    entry.debit('cash', gross - charged);
    for (const [rate, rateGross] of grossByRate) {
      const vat = vatOf(rateGross, rate);
      entry.credit('revenue', rateGross - vat).credit('vat_out', vat);
    }
    entry.debit('cost_of_sales', cost).credit('stock', cost);

    let description: string;
    if (key[0] === 'i') {
      const doc = await this.db.selectFrom('documents').select('number').where('id', '=', Number(key.slice(1))).executeTakeFirst();
      description = doc?.number ?? '';
    } else if (key[0] === 'r') {
      description = `TREFIN ${rows[0]!.receipt_no}`;
    } else {
      description = `${rows[0]!.quantity} × ${rows[0]!.product_name}`;
    }
    return entry.build(day, description, withoutCost > 0 ? `no_cost:${withoutCost}` : null);
  }

  private async saleReturn(id: number): Promise<DraftEntry | null> {
    const row = await sql<{
      day: string;
      quantity: number;
      refund: string;
      unit_cost: string | null;
      vat_rate: number;
      product_name: string;
      off_tab: string;
      customer_id: number | null;
    }>`
      select ${zonedDaySql(sql.ref('r.decided_at'), this.timeZone)} as day, r.quantity, r.refund_amount as refund, s.unit_cost, p.name as product_name,
        coalesce((select dl.vat_rate from document_lines dl where dl.sale_id = s.id order by dl.id desc limit 1), p.vat_rate) as vat_rate,
        coalesce((select sum(t.amount) from tab_entries t where t.return_id = r.id and t.kind = 'refund'), 0) as off_tab,
        (select t.customer_id from tab_entries t where t.return_id = r.id and t.kind = 'refund' limit 1) as customer_id
      from returns r join sales s on s.id = r.sale_id join products p on p.id = s.product_id
      where r.id = ${id} and r.status = 'approved' and r.undone_at is null and r.decided_at is not null
    `
      .execute(this.db)
      .then((result) => result.rows[0]);
    if (!row || this.tooEarly(row.day)) return null;
    const refund = Number(row.refund);
    const offTab = Number(row.off_tab);
    const vat = vatOf(refund, row.vat_rate);
    const entry = this.builder()
      .debit('sales_returns', refund - vat)
      .debit('vat_out', vat)
      .credit('receivables', offTab, { customerId: row.customer_id })
      .credit('cash', refund - offTab);
    const cost = row.unit_cost === null ? 0 : row.quantity * Number(row.unit_cost);
    entry.debit('stock', cost).credit('cost_of_sales', cost);
    return entry.build(row.day, `${row.quantity} × ${row.product_name}`, row.unit_cost === null ? 'no_cost:1' : null);
  }

  /** Stock lost at cost: stock corrections against stock. `quantity` is negative for a loss. */
  private stockChange(day: string, quantity: number, unitCost: number | null, description: string): DraftEntry | null {
    if (this.tooEarly(day) || unitCost === null) return null;
    const value = roundMoney(Math.abs(quantity) * unitCost);
    const entry = this.builder();
    if (quantity < 0) entry.debit('stock_corrections', value).credit('stock', value);
    else entry.debit('stock', value).credit('stock_corrections', value);
    return entry.build(day, description);
  }

  private async writeOff(id: number): Promise<DraftEntry | null> {
    const row = await this.db
      .selectFrom('write_offs as w')
      .innerJoin('products as p', 'p.id', 'w.product_id')
      .select(['w.quantity', 'w.unit_cost', 'p.cost_price', 'p.name', zonedDaySql(sql.ref('w.decided_at'), this.timeZone).as('day')])
      .where('w.id', '=', id)
      .where('w.status', '=', 'approved')
      .where('w.undone_at', 'is', null)
      .where('w.decided_at', 'is not', null)
      .executeTakeFirst();
    if (!row) return null;
    return this.stockChange(row.day, -row.quantity, n(row.unit_cost) ?? n(row.cost_price), `${row.quantity} × ${row.name}`);
  }

  private async countLine(id: number): Promise<DraftEntry | null> {
    const row = await this.db
      .selectFrom('stock_count_lines as l')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .select(['l.counted_quantity', 'l.expected_quantity', 'l.unit_cost', 'p.cost_price', 'p.name', zonedDaySql(sql.ref('l.decided_at'), this.timeZone).as('day')])
      .where('l.id', '=', id)
      .where('l.status', '=', 'approved')
      .where('l.undone_at', 'is', null)
      .where('l.decided_at', 'is not', null)
      .executeTakeFirst();
    if (!row) return null;
    const difference = row.counted_quantity - row.expected_quantity;
    if (difference === 0) return null;
    return this.stockChange(row.day, difference, n(row.unit_cost) ?? n(row.cost_price), `${difference > 0 ? '+' : ''}${difference} × ${row.name}`);
  }

  /** Only a manual correction posts: deliveries come in through their bill, and sales, returns, counts and write-offs post themselves. */
  private async adjustment(id: number): Promise<DraftEntry | null> {
    const row = await this.db
      .selectFrom('stock_adjustments as a')
      .innerJoin('products as p', 'p.id', 'a.product_id')
      .select(['a.adjustment_quantity', 'p.cost_price', 'p.name', zonedDaySql(sql.ref('a.adjustment_date'), this.timeZone).as('day')])
      .where('a.id', '=', id)
      .where('a.reason', '=', 'Manual adjustment')
      .executeTakeFirst();
    if (!row) return null;
    const quantity = row.adjustment_quantity;
    return this.stockChange(row.day, quantity, n(row.cost_price), `${quantity > 0 ? '+' : ''}${quantity} × ${row.name}`);
  }

  private async bill(id: number): Promise<DraftEntry | null> {
    const bill = await this.db
      .selectFrom('supplier_bills as b')
      .leftJoin('suppliers as s', 's.id', 'b.supplier_id')
      .select([
        'b.supplier_id',
        'b.order_id',
        'b.number',
        'b.amount',
        'b.vat_amount',
        'b.kind',
        'b.withheld',
        'b.customs_vat',
        'b.customs_duty',
        'b.customs_paid_method',
        'b.place',
        's.name',
        sql<string>`to_char(b.issued_on, 'YYYY-MM-DD')`.as('issued_on'),
        sql<string | null>`to_char(b.vat_month, 'YYYY-MM-DD')`.as('vat_month'),
      ])
      .where('b.id', '=', id)
      .where('b.voided_at', 'is', null)
      .executeTakeFirst();
    if (!bill || this.tooEarly(bill.issued_on) || bill.place === 'carwash') return null;
    // A bill that came after its month was filed is booked on the first day of the month it counts in.
    const day = bill.vat_month !== null && bill.vat_month > bill.issued_on ? bill.vat_month : bill.issued_on;
    const lines = await this.db
      .selectFrom('bill_lines')
      .select(['kind', 'category', 'net', 'vat', 'landed', 'self_vat', 'spread', 'order_line_id'])
      .where('bill_id', '=', id)
      .orderBy('position')
      .execute();
    const party = { supplierId: bill.supplier_id };
    const amount = Number(bill.amount);
    const withheld = Number(bill.withheld);
    const description = bill.name ? (bill.number ? `${bill.name} ${bill.number}` : bill.name) : (bill.number ?? lines[0]?.category ?? '');

    if (lines.length === 0) {
      // A bill typed as a total, before bills had lines: all of it is stock.
      let vat = n(bill.vat_amount);
      if (vat === null && bill.order_id !== null) vat = await this.vatFromOrder(bill.order_id, amount);
      return this.builder()
        .debit('stock', amount - (vat ?? 0))
        .debit('vat_in', vat ?? 0)
        .credit('payables', amount, party)
        .build(day, description, vat === null ? 'no_vat' : null);
    }

    // A return or credit posts its lines the other way round.
    const sign = bill.kind === 'credit' ? -1 : 1;
    const entry = this.builder();
    const debit = (account: AccountLinkKey, value: number, onParty = {}) => entry.debit(account, sign * value, onParty);
    let warning: string | null = null;
    const others = lines.filter((line) => line.kind !== 'product');
    const products = lines.filter((line) => line.kind === 'product');
    let vatIn = others.reduce((sum, line) => sum + Number(line.vat), 0);
    for (const line of others) {
      if (line.kind === 'equipment') debit(`asset:${line.category}` as AccountLinkKey, Number(line.landed));
      else if (!line.spread) debit(`expense:${line.category}` as AccountLinkKey, Number(line.net));
      // VAT on a service from abroad, charged to yourself: owed and claimed back at once.
      const selfVat = Number(line.self_vat);
      if (selfVat > 0) {
        debit('vat_in', selfVat);
        debit('vat_out', -selfVat);
      }
    }
    if (products.length > 0) {
      if (products.every((line) => line.order_line_id === null)) {
        debit('stock', products.reduce((sum, line) => sum + Number(line.landed), 0));
        vatIn += products.reduce((sum, line) => sum + Number(line.vat), 0);
      } else {
        // A delivery's lines say what share of the paper's total is VAT; the paper's total wins.
        const othersGross = others.reduce((sum, line) => sum + Number(line.net) + Number(line.vat), 0);
        const productsGross = roundMoney(amount + withheld - othersGross);
        const linesGross = products.reduce((sum, line) => sum + Number(line.net) + Number(line.vat), 0);
        const linesVat = products.reduce((sum, line) => sum + Number(line.vat), 0);
        let productsVat: number;
        if (n(bill.vat_amount) !== null) productsVat = roundMoney(Number(bill.vat_amount) - vatIn);
        else if (linesGross > 0) productsVat = roundMoney((productsGross * linesVat) / linesGross);
        else {
          productsVat = 0;
          warning = 'no_vat';
        }
        debit('stock', productsGross - productsVat);
        vatIn += productsVat;
      }
    }
    const customsVat = n(bill.customs_vat) ?? 0;
    const duty = n(bill.customs_duty) ?? 0;
    debit('vat_in', vatIn + customsVat);
    // Customs VAT and duty are paid at the border.
    if (customsVat + duty > 0) debit(bill.customs_paid_method === 'cash' ? 'cash' : 'bank', -(customsVat + duty));
    debit('payables', -amount, party);
    debit('withholding', -withheld);
    return entry.build(day, description, warning);
  }

  /** The VAT in a bill that came from an order, by the rates of the products on it; null when the order has no costs. */
  private async vatFromOrder(orderId: number, gross: number): Promise<number | null> {
    const lines = await this.db
      .selectFrom('purchase_order_lines as l')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .select(['l.quantity', 'l.received_quantity', 'l.unit_cost', 'p.vat_rate'])
      .where('l.order_id', '=', orderId)
      .where('l.unit_cost', 'is not', null)
      .execute();
    let linesGross = 0;
    let linesVat = 0;
    for (const line of lines) {
      const value = (line.received_quantity ?? line.quantity) * Number(line.unit_cost);
      linesGross += value;
      linesVat += (value * line.vat_rate) / (100 + line.vat_rate);
    }
    // The bill's own total wins; the order only says what share of it is VAT.
    return linesGross > 0 ? roundMoney((gross * linesVat) / linesGross) : null;
  }

  private async payment(id: number): Promise<DraftEntry | null> {
    const row = await this.db
      .selectFrom('supplier_payments as pay')
      .innerJoin('supplier_bills as b', 'b.id', 'pay.bill_id')
      .leftJoin('suppliers as s', 's.id', 'b.supplier_id')
      .select(['pay.amount', 'pay.method', 'b.supplier_id', 'b.number', 'b.place', 's.name', sql<string>`to_char(pay.paid_on, 'YYYY-MM-DD')`.as('paid_on')])
      .where('pay.id', '=', id)
      .where('pay.voided_at', 'is', null)
      // A credit applied to a bill posts nothing more: the return or credit posted itself.
      .where('pay.method', '!=', 'credit')
      .executeTakeFirst();
    if (!row || this.tooEarly(row.paid_on) || row.place === 'carwash') return null;
    const amount = Number(row.amount);
    return this.builder()
      .debit('payables', amount, { supplierId: row.supplier_id })
      .credit(row.method === 'bank' ? 'bank' : 'cash', amount)
      .build(row.paid_on, row.name ? (row.number ? `${row.name} ${row.number}` : row.name) : (row.number ?? ''));
  }

  /** Expenses were their own documents until they became bills paid on the spot; their old entries are reversed. */
  private async expense(_id: number): Promise<DraftEntry | null> {
    return null;
  }

  private async tabPayment(id: number): Promise<DraftEntry | null> {
    const row = await this.db
      .selectFrom('tab_entries as t')
      .innerJoin('customers as c', 'c.id', 't.customer_id')
      .select(['t.amount', 't.customer_id', 'c.name', zonedDaySql(sql.ref('t.occurred_at'), this.timeZone).as('day')])
      .where('t.id', '=', id)
      .where('t.kind', '=', 'payment')
      .executeTakeFirst();
    if (!row || this.tooEarly(row.day)) return null;
    const amount = Number(row.amount);
    return this.builder().debit('cash', amount).credit('receivables', amount, { customerId: row.customer_id }).build(row.day, row.name);
  }
}
