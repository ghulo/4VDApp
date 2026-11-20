import { sql } from 'kysely';
import type { DatabaseClient } from '../../database/connection.js';
import type { CustomsPaidMethod } from '../../constants/bills.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/httpErrors.js';
import type { BillLineRecord, BillRecord } from '../../repositories/SupplierBillRepository.js';
import type { TransactionalRepositories } from '../../repositories/TransactionManager.js';
import { roundMoney } from '../../utils/money.js';
import { changeCost } from '../PurchaseOrderService.js';
import { assertMonthsOpen, monthOf, vatMonthForBill } from '../vat/periodLock.js';
import { spreadByValue } from './billFigures.js';

/** What a customs paper (Dogana e Kosovës' declaration) says. */
export interface CustomsInput {
  /** The declaration's number. */
  number: string | null;
  issuedOn: string;
  vat: number;
  duty: number;
  /** Akciza; 0 when none. It lands on the goods like the duty. */
  excise?: number;
  method: CustomsPaidMethod;
}

/** What the scanner read off a paper, kept to find its bill. */
export interface CustomsReading {
  supplierName: string | null;
  invoiceNumbers: string[];
  declaredValue: number | null;
  scanId: number | null;
}

/** The goods on a bill that take a share of the duty: products and equipment, in the bill's order. */
const goodsOf = (lines: BillLineRecord[]) => lines.filter((line) => line.kind === 'product' || line.kind === 'equipment').sort((a, b) => a.position - b.position);

/** The VAT month a paper counts in: its own, or the next open one when its own was filed (like a late bill). */
export const paperMonth = (paper: { issued_on: string; vat_month: string | null }) => paper.vat_month ?? monthOf(paper.issued_on);

/**
 * Why a bill can't carry customs, or null when it can: an open import bill
 * (a supplier abroad) with goods on it.
 */
export function customsBlocker(bill: BillRecord, lines: BillLineRecord[]): string | null {
  if (bill.trefin_ref) return "This bill is TREFIN's history. It can be looked at, not changed.";
  if (bill.voided_at) return 'This bill was voided';
  if (bill.kind !== 'bill') return 'Customs go on the bill, not on a return or credit';
  if (!bill.abroad) return 'Customs are only for goods from a supplier abroad';
  if (goodsOf(lines).length === 0) return 'Customs need goods on the bill';
  return null;
}

function checkInput(input: CustomsInput, bill: BillRecord, today: string) {
  if (input.issuedOn > today) throw new ValidationError("The customs paper can't be dated after today");
  if (input.vat + input.duty + (input.excise ?? 0) <= 0) throw new ValidationError('Type the customs VAT or the duty');
  // A paper usually comes days before or after its bill; a year apart is a typo.
  const gap = Math.abs(Date.parse(input.issuedOn) - Date.parse(bill.issued_on)) / 86_400_000;
  if (gap > 366) throw new ValidationError('The customs paper is dated more than a year from its bill. Check the date.');
}

/**
 * Put a bill's customs on it, change them, or take them off (input null).
 * Duty and excise are spread over its goods by value (bill_lines.duty, in
 * landed); the paper posts on its own date (see postingRules `customs`), so
 * its VAT counts in the month of the paper.
 *
 * `costs`: whether to move the products' costs by the change. The bill form
 * leaves them alone: its new costs already carry the duty.
 *
 * Default until the accountant confirms (handoff.md): duty that comes after
 * some units were sold goes onto the cost of the units still in stock (sold
 * ones keep their cost); when none are left, it goes to cost of sales.
 */
export async function setCustoms(
  repos: TransactionalRepositories,
  billId: number,
  input: CustomsInput | null,
  actorId: number | null,
  options: { today: string; costs?: boolean; reading?: CustomsReading; quiet?: boolean },
): Promise<number | null> {
  await repos.bills.lock(billId);
  const bill = await repos.bills.findById(billId);
  if (!bill) throw new NotFoundError(`Bill ${billId} does not exist`);
  const lines = await repos.bills.findLines([billId]);
  const blocker = customsBlocker(bill, lines);
  if (blocker) throw new ConflictError(blocker);
  const old = await currentPaper(repos, billId);
  if (old) await assertMonthsOpen(repos.periods, [paperMonth(old)]);
  if (input) checkInput(input, bill, options.today);

  const goods = goodsOf(lines);
  const newDuty = input ? roundMoney(input.duty + (input.excise ?? 0)) : 0;
  const oldDuty = roundMoney(goods.reduce((sum, line) => sum + Number(line.duty), 0));
  // Equipment is in the assets register at its cost, and may have depreciated since: its duty is typed with the bill.
  if (newDuty !== oldDuty && options.costs !== false && goods.some((line) => line.kind === 'equipment')) {
    throw new ValidationError("This bill has equipment, so its duty can't change after it was saved. Void the bill and enter it again with its customs, or change only the VAT.");
  }

  let paperId: number | null = null;
  if (old) {
    await repos.db.updateTable('customs_papers').set({ voided_at: new Date() }).where('id', '=', old.id).execute();
  }
  if (input) {
    const row = await repos.db
      .insertInto('customs_papers')
      .values({
        bill_id: billId,
        number: input.number?.trim() || null,
        issued_on: input.issuedOn,
        vat_month: await vatMonthForBill(repos.periods, input.issuedOn),
        vat: input.vat,
        duty: input.duty,
        excise: input.excise ?? 0,
        paid_method: input.method,
        scan_id: options.reading?.scanId ?? old?.scan_id ?? null,
        supplier_name: options.reading?.supplierName ?? null,
        invoice_numbers: options.reading?.invoiceNumbers ?? [],
        declared_value: options.reading?.declaredValue ?? null,
        created_by: actorId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    paperId = row.id;
  }
  if (newDuty !== oldDuty) await spreadDuty(repos, bill, goods, newDuty, actorId, options.costs !== false);

  if (!options.quiet) {
    await repos.activityLog.create({
      userId: actorId,
      action: 'bill.updated',
      entityType: 'bill',
      entityId: billId,
      say: input
        ? { key: old ? 'customsChanged' : 'customsAdded', params: { amount: Number(bill.amount), supplier: bill.supplier_name, number: bill.number, vat: input.vat, duty: newDuty } }
        : { key: 'customsRemoved', params: { amount: Number(bill.amount), supplier: bill.supplier_name, number: bill.number } },
      details: { from: old ? { vat: Number(old.vat), duty: Number(old.duty), excise: Number(old.excise), number: old.number, issuedOn: old.issued_on } : null, to: input },
    });
  }
  return paperId;
}

/** The paper now on a bill, if any. */
export async function currentPaper(repos: TransactionalRepositories, billId: number) {
  return repos.db
    .selectFrom('customs_papers')
    .select([
      'id',
      'number',
      'vat',
      'duty',
      'excise',
      'paid_method',
      'scan_id',
      sql<string>`to_char(issued_on, 'YYYY-MM-DD')`.as('issued_on'),
      sql<string | null>`to_char(vat_month, 'YYYY-MM-DD')`.as('vat_month'),
    ])
    .where('bill_id', '=', billId)
    .where('voided_at', 'is', null)
    .executeTakeFirst();
}

/**
 * The duty's new shares on the goods, and (when `costs`) the products' costs
 * moved by the change: onto the units still in stock, or to cost of sales
 * when none are left.
 */
async function spreadDuty(repos: TransactionalRepositories, bill: BillRecord, goods: BillLineRecord[], duty: number, actorId: number | null, costs: boolean) {
  const shares = spreadByValue(duty, goods.map((line) => Number(line.net)));
  const byProduct = new Map<number, { units: number; change: number; lines: Array<{ line: BillLineRecord; share: number }> }>();
  for (const [index, line] of goods.entries()) {
    const share = shares[index]!;
    if (line.kind === 'product' && line.product_id !== null && costs) {
      const entry = byProduct.get(line.product_id) ?? { units: 0, change: 0, lines: [] };
      entry.units += line.quantity ?? 0;
      entry.change = roundMoney(entry.change + share - Number(line.duty));
      entry.lines.push({ line, share });
      byProduct.set(line.product_id, entry);
    } else {
      await setLineDuty(repos, line, share, Number(line.duty_expensed));
    }
  }
  for (const [productId, entry] of byProduct) {
    const left = Math.min(entry.units, Math.max(await repos.inventory.onHandForUpdate(productId), 0));
    let toCost = 0;
    for (const { line, share } of entry.lines) {
      const before = Number(line.duty_expensed);
      // None left: the change goes to cost of sales. Some left: what was expensed shrinks only if the duty does.
      const expensed = left <= 0 ? Math.min(Math.max(roundMoney(before + share - Number(line.duty)), 0), share) : Math.min(before, share);
      toCost = roundMoney(toCost + share - Number(line.duty) - (expensed - before));
      await setLineDuty(repos, line, share, expensed);
    }
    if (left <= 0 || toCost === 0) continue;
    const product = await repos.products.findById(productId, true);
    if (!product || product.cost_price === null) continue;
    // Costs in 4VD include VAT: the duty is put back on at the product's rate, as the bill form does.
    const from = Number(product.cost_price);
    const to = Math.max(roundMoney(from + ((toCost / left) * (100 + product.vat_rate)) / 100), 0);
    if (actorId !== null) await changeCost(repos, { productId, productName: product.name, from, to, actorId, because: { customs: bill.supplier_name ?? '' } });
    else await repos.orders.setCostPrice(productId, to);
  }
}

async function setLineDuty(repos: TransactionalRepositories, line: BillLineRecord, share: number, expensed: number) {
  await repos.db
    .updateTable('bill_lines')
    .set({ duty: share, duty_expensed: roundMoney(expensed), landed: roundMoney(Number(line.landed) - Number(line.duty) + share) })
    .where('id', '=', line.id)
    .execute();
}

/** A bill voided: its paper is let go, to wait for the bill entered again. */
export async function releasePaper(repos: TransactionalRepositories, billId: number): Promise<void> {
  await repos.db.updateTable('customs_papers').set({ bill_id: null }).where('bill_id', '=', billId).where('voided_at', 'is', null).execute();
}

/** Mark an import as having no customs paper (under the limit), or take that back. */
export async function setNoCustoms(repos: TransactionalRepositories, billId: number, value: boolean, actorId: number): Promise<void> {
  await repos.bills.lock(billId);
  const bill = await repos.bills.findById(billId);
  if (!bill) throw new NotFoundError(`Bill ${billId} does not exist`);
  if (value && bill.customs_id !== null) throw new ConflictError('This bill has its customs paper. Remove that first.');
  await repos.db.updateTable('supplier_bills').set({ no_customs: value }).where('id', '=', billId).execute();
  await repos.activityLog.create({
    userId: actorId,
    action: 'bill.updated',
    entityType: 'bill',
    entityId: billId,
    say: { key: value ? 'customsNone' : 'customsNoneUndone', params: { amount: Number(bill.amount), supplier: bill.supplier_name, number: bill.number } },
  });
}

/** An import may wait this long for its customs paper before 4VD asks for it. */
export const CUSTOMS_GRACE_DAYS = 7;

/**
 * Import bills with goods and no customs paper, dated more than
 * CUSTOMS_GRACE_DAYS ago, that nobody marked "no customs".
 */
export async function customsMissing(db: DatabaseClient, today: string): Promise<Array<{ id: number; supplier: string | null; number: string | null }>> {
  return db
    .selectFrom('supplier_bills as b')
    .leftJoin('suppliers as s', 's.id', 'b.supplier_id')
    .select(['b.id', 's.name as supplier', 'b.number'])
    .where('b.kind', '=', 'bill')
    .where('b.abroad', '=', true)
    .where('b.no_customs', '=', false)
    .where('b.voided_at', 'is', null)
    .where('b.trefin_ref', 'is', null)
    .where('b.brought_over', '=', false)
    .where('b.place', '<>', 'carwash')
    .where(sql<boolean>`b.issued_on <= ${today}::date - ${CUSTOMS_GRACE_DAYS}::int`)
    .where((eb) => eb.exists(eb.selectFrom('bill_lines as l').select('l.id').whereRef('l.bill_id', '=', 'b.id').where('l.kind', 'in', ['product', 'equipment'])))
    .where((eb) => eb.not(eb.exists(eb.selectFrom('customs_papers as p').select('p.id').whereRef('p.bill_id', '=', 'b.id').where('p.voided_at', 'is', null))))
    .orderBy('b.issued_on')
    .execute();
}

/** Customs papers waiting for their bill. */
export async function waitingPapers(db: DatabaseClient): Promise<Array<{ id: number; number: string | null; supplier: string | null; issuedOn: string }>> {
  const rows = await db
    .selectFrom('customs_papers')
    .select(['id', 'number', 'supplier_name', sql<string>`to_char(issued_on, 'YYYY-MM-DD')`.as('issued_on')])
    .where('bill_id', 'is', null)
    .where('voided_at', 'is', null)
    .orderBy('issued_on')
    .execute();
  return rows.map((row) => ({ id: row.id, number: row.number, supplier: row.supplier_name, issuedOn: row.issued_on }));
}
