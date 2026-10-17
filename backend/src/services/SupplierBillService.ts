import { type BillKind, type BillLineKind, type CustomsPaidMethod, EQUIPMENT_CATEGORIES, WITHHOLDING_RATES, type WithholdingType } from '../constants/bills.js';
import { EXPENSE_CATEGORIES, type ExpensePlace } from '../constants/expenses.js';
import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import type { MoneyPlaceKind, SupplierPaymentMethod } from '../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { BillFilters, BillLineRecord, BillRecord, NewBillLine, PaymentRecord, RepeatRecord, SupplierBillRepository } from '../repositories/SupplierBillRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { zonedDay } from '../utils/zonedDates.js';
import { type BillFigures, billFigures, priceKeepingMargin } from './bills/billFigures.js';
import { vatOf } from './books/entryBuilder.js';
import { applyStockChange } from './InventoryService.js';
import { mediaUrl } from './mappers.js';
import type { MediaService } from './MediaService.js';
import { validatePricingTiers } from './pricing/bulkPricing.js';
import { changeCost } from './PurchaseOrderService.js';
import { assertMonthsOpen, monthOf, vatMonthForBill } from './vat/periodLock.js';
import { placeWords } from '../repositories/MoneyRepository.js';

/** A bill due within this many days counts as "due soon". */
export const BILL_DUE_SOON_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** A monthly bill's day is capped here so every month has it. */
export const LAST_REPEAT_DAY = 28;

export type BillStatus = 'unpaid' | 'partly_paid' | 'paid' | 'void';

export interface SupplierPaymentDto {
  id: number;
  /** The bill it paid: the same bill, or for a credit shown on its return, the bill it went against. */
  billId: number;
  amount: number;
  paidOn: string;
  method: SupplierPaymentMethod;
  /** Where the money came from (null for a credit); a null name is its kind's usual name. */
  place: { id: number; kind: MoneyPlaceKind; name: string | null } | null;
  /** Paid with other bills in one payment. */
  groupId: number | null;
  /** For a credit: the return or credit that paid it. */
  credit: { id: number; number: string | null } | null;
  note: string | null;
  recordedBy: string | null;
  voided: boolean;
}

export interface BillLineDto {
  id: number;
  kind: BillLineKind;
  productId: number | null;
  productName: string | null;
  quantity: number | null;
  /** The price for one, as the paper shows it. */
  unitPrice: number | null;
  category: string | null;
  description: string | null;
  vatRate: number;
  /** Exempt from VAT (its rate is 0). */
  vatExempt: boolean;
  net: number;
  vat: number;
  gross: number;
  /** The net plus its share of an import's duty and transport. */
  landed: number;
  /** Transport on an import, added to the goods' cost. */
  spread: boolean;
  /** VAT charged to yourself on a service from abroad. */
  selfVat: number;
  /** The stock came in with a delivery (an order), not with the bill. */
  fromDelivery: boolean;
}

export interface SupplierBillDto {
  id: number;
  kind: BillKind;
  /** Null for an expense paid to nobody in particular. */
  supplier: { id: number; name: string } | null;
  orderId: number | null;
  /** The supplier's own invoice number. */
  number: string | null;
  issuedOn: string;
  /**
   * The VAT month it counts in, "2026-10", when that is not its own: it came
   * after its month was filed, so it counts in the next open month. Null: its own month.
   */
  vatMonth: string | null;
  dueOn: string | null;
  /** What the supplier is owed (a return or credit: what it gives back). */
  amount: number;
  /** What the paper adds up to: the amount plus any tax held back. */
  total: number;
  vatAmount: number | null;
  /** VAT to claim back: the paper's and the customs VAT. */
  vatToClaim: number;
  /** Paid so far (a return or credit: how much of it went against its bill). */
  paid: number;
  /** What is still owed; 0 once paid or voided. A return or credit: what the supplier still owes you. */
  left: number;
  status: BillStatus;
  /** Money still owed and the due date has passed. */
  overdue: boolean;
  /** Days until due (negative once late); null without a due date or once settled. */
  daysLeft: number | null;
  note: string | null;
  photoUrl: string | null;
  /** Confirmed from this scanned bill. */
  scanId: number | null;
  recordedBy: string | null;
  voidNote: string | null;
  /** An expense: paid when it was entered. */
  paidNow: boolean;
  pricesIncludeVat: boolean;
  /** From a supplier abroad: an import. */
  abroad: boolean;
  customs: { vat: number; duty: number; method: CustomsPaidMethod } | null;
  withholding: { type: WithholdingType; rate: number; amount: number } | null;
  place: ExpensePlace;
  carwash: { id: number; name: string } | null;
  /** Made by a monthly repeat. */
  repeatId: number | null;
  /** A return or credit: the bill it is against, and whether its units went back out of stock. */
  creditFor: { id: number; number: string | null } | null;
  returnsStock: boolean;
  /** Returns and credits against this bill (only on a single bill). */
  credits: Array<{ id: number; number: string | null; issuedOn: string; amount: number; returnsStock: boolean; voided: boolean }>;
  lines: BillLineDto[];
  payments: SupplierPaymentDto[];
}

export interface BillInput {
  number: string | null;
  issuedOn: string;
  dueOn: string | null;
  amount: number;
  /** The VAT in the amount; null or missing when unknown. */
  vatAmount?: number | null;
  note: string | null;
}

export interface BillLineInput {
  kind: BillLineKind;
  productId?: number | null;
  quantity?: number | null;
  /** A product's price for one as on the paper. */
  unitPrice?: number | null;
  category?: string | null;
  description?: string | null;
  /** A cost's or equipment's amount as on the paper. */
  amount?: number | null;
  /** Left out: the product's own rate, else the supplier's usual, else 18%. */
  vatRate?: number | null;
  /** Exempt from VAT (with a 0% rate); left out follows the rate's source like vatRate. */
  vatExempt?: boolean | null;
}

/**
 * Everything the one bill form can say. With `lines`, 4VD works out the
 * amount, VAT and what each line does; without them it is a bill typed as a
 * total (from a delivery, a scan, or the old form).
 */
export interface NewBillInput {
  supplierId: number | null;
  orderId?: number | null;
  number: string | null;
  issuedOn: string;
  dueOn: string | null;
  note: string | null;
  amount?: number;
  vatAmount?: number | null;
  lines?: BillLineInput[];
  /** Whether the paper's prices include VAT (they usually do). */
  pricesIncludeVat?: boolean;
  /** From the customs paper, for an import. */
  customs?: { vat: number; duty: number; method: CustomsPaidMethod } | null;
  withholdingType?: WithholdingType | null;
  /** An expense: paid now, from here. */
  paidNow?: { method?: Exclude<SupplierPaymentMethod, 'credit'> | null; placeId?: number | null } | null;
  place?: ExpensePlace;
  carwashId?: number | null;
  /** Make the same bill by itself every month. */
  repeatMonthly?: boolean;
  /** Copy the products' new costs onto them (default yes). */
  updateCosts?: boolean;
  /** New shelf prices chosen from the price alerts. */
  prices?: Array<{ productId: number; price: number }>;
}

export interface CreditInput {
  /** A return: the product lines' units go back out of stock. Otherwise only what's owed goes down. */
  returnsStock: boolean;
  number: string | null;
  issuedOn: string;
  note: string | null;
  pricesIncludeVat?: boolean;
  lines: BillLineInput[];
}

export interface PaymentInput {
  amount: number;
  paidOn: string;
  /** Where the money came from; or only how it was paid (the drawer, other cash, the bank), for its usual place. */
  placeId?: number | null;
  method?: Exclude<SupplierPaymentMethod, 'credit'> | null;
  note: string | null;
}

export interface PayablesSummary {
  /** Everything still owed. */
  owed: number;
  overdue: { count: number; amount: number };
  dueSoon: { count: number; amount: number };
  bySupplier: Array<{ supplierId: number; name: string; owed: number; overdue: number; bills: number }>;
}

/** What a bill will do, before it is saved: the figures, and for each product, how its cost and margin move. */
export interface BillPreviewDto extends BillFigures {
  abroad: boolean;
  /** Customs only apply to goods and equipment from abroad. */
  hasGoods: boolean;
  priceAlerts: Array<{
    productId: number;
    name: string;
    oldCost: number | null;
    newCost: number;
    price: number;
    /** Margin in percent of the shelf price, before and after. */
    marginBefore: number | null;
    marginAfter: number;
    /** A shelf price that keeps the old margin. */
    suggestedPrice: number;
  }>;
}

export interface BillRepeatDto {
  id: number;
  supplier: { id: number; name: string } | null;
  amount: number;
  category: string | null;
  place: ExpensePlace;
  carwashId: number | null;
  carwashName: string | null;
  note: string | null;
  dayOfMonth: number;
  addedBy: string | null;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);

/** The same day of the month after `day` ("2026-10-28" → "2026-11-28"). */
export function nextMonthDay(day: string, dayOfMonth: number): string {
  const [year, month] = day.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, dayOfMonth)).toISOString().slice(0, 10);
}

/**
 * What the shop owes its suppliers and what it spends: every kind of bill on
 * one record. A bill to pay later is paid at once or in parts; an expense is
 * the same record, paid when it is entered. Drawer payments come out of the
 * till, so the cash check expects less.
 */
export class SupplierBillService {
  constructor(
    private readonly billRepository: SupplierBillRepository,
    private readonly mediaService: MediaService,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  today(now = new Date()): string {
    return zonedDay(now, this.timeZone);
  }

  async list(filters: BillFilters, now = new Date()): Promise<SupplierBillDto[]> {
    const bills = await this.billRepository.findMany(filters);
    const ids = bills.map((bill) => bill.id);
    const [payments, lines] = await Promise.all([this.billRepository.findPayments(ids), this.billRepository.findLines(ids)]);
    return bills.map((bill) => toDto(bill, payments, lines, [], this.today(now)));
  }

  async get(id: number, now = new Date()): Promise<SupplierBillDto> {
    const bill = await this.billRepository.findById(id);
    if (!bill) throw new NotFoundError(`Bill ${id} does not exist`);
    const [payments, lines, credits] = await Promise.all([
      this.billRepository.findPayments([id]),
      this.billRepository.findLines([id]),
      this.billRepository.findCredits(id),
    ]);
    return toDto(bill, payments, lines, credits, this.today(now));
  }

  /** Totals for the Bills page, the reports and the attention list. */
  async summary(now = new Date()): Promise<PayablesSummary> {
    const open = await this.list({ status: 'open' }, now);
    const bySupplier = new Map<number, PayablesSummary['bySupplier'][number]>();
    for (const bill of open) {
      if (!bill.supplier) continue;
      const entry = bySupplier.get(bill.supplier.id) ?? { supplierId: bill.supplier.id, name: bill.supplier.name, owed: 0, overdue: 0, bills: 0 };
      entry.owed = roundMoney(entry.owed + bill.left);
      if (bill.overdue) entry.overdue = roundMoney(entry.overdue + bill.left);
      entry.bills += 1;
      bySupplier.set(bill.supplier.id, entry);
    }
    const sum = (bills: SupplierBillDto[]) => ({ count: bills.length, amount: roundMoney(bills.reduce((total, bill) => total + bill.left, 0)) });
    return {
      owed: sum(open).amount,
      overdue: sum(open.filter((bill) => bill.overdue)),
      dueSoon: sum(open.filter((bill) => !bill.overdue && bill.daysLeft !== null && bill.daysLeft <= BILL_DUE_SOON_DAYS)),
      bySupplier: [...bySupplier.values()].sort((a, b) => b.overdue - a.overdue || b.owed - a.owed),
    };
  }

  /** What the bill form's lines come to and what saving them will do, without saving anything. */
  async preview(input: NewBillInput): Promise<BillPreviewDto> {
    return this.transactions.run(async (repos) => {
      const plan = await planBill(repos, input);
      return { ...plan.figures, abroad: plan.abroad, hasGoods: plan.hasGoods, priceAlerts: plan.priceAlerts };
    });
  }

  async create(input: NewBillInput, actorId: number, now = new Date()): Promise<SupplierBillDto> {
    const id = await this.transactions.run((repos) => createBill(repos, input, actorId, { today: this.today(now) }));
    return this.get(id!);
  }

  /** A return or credit against a bill, pre-filled on the form from its lines. */
  async credit(billId: number, input: CreditInput, actorId: number, now = new Date()): Promise<SupplierBillDto> {
    const id = await this.transactions.run((repos) => createCredit(repos, billId, input, actorId, this.today(now)));
    return this.get(id);
  }

  /** Correct a typo. A bill worked out from its lines keeps its amount; the amount can't drop below what is paid. */
  async update(id: number, input: BillInput, actorId: number): Promise<SupplierBillDto> {
    await this.transactions.run(async (repos) => {
      await repos.bills.lock(id);
      const bill = await openBill(repos, id);
      await assertBillOpen(repos, bill);
      checkDates(input);
      const lines = await repos.bills.findLines([id]);
      const typed = lines.length > 0 && lines.every((line) => line.order_line_id === null);
      if (typed && roundMoney(input.amount) !== Number(bill.amount)) {
        throw new ValidationError("This bill's total comes from its lines. To change it, void the bill and enter it again, or add a return or credit.");
      }
      if (input.amount < Number(bill.paid)) {
        throw new ValidationError(`The amount can't be less than the ${formatEuro(Number(bill.paid))} already paid`);
      }
      await repos.bills.update(id, typed ? { ...input, vatAmount: undefined } : input);
      if (input.issuedOn !== bill.issued_on) await placeInVatMonth(repos, id, input.issuedOn);
      await repos.activityLog.create({
        userId: actorId,
        action: 'bill.updated',
        entityType: 'bill',
        entityId: id,
        say: { key: 'billEdited', params: billWords(bill) },
        details: { from: { number: bill.number, issuedOn: bill.issued_on, dueOn: bill.due_on, amount: Number(bill.amount), note: bill.note }, to: input },
      });
    });
    return this.get(id);
  }

  async pay(id: number, input: PaymentInput, actorId: number, now = new Date()): Promise<SupplierBillDto> {
    if (input.paidOn > this.today(now)) throw new ValidationError("paidOn can't be in the future");
    await this.transactions.run((repos) => payBill(repos, id, input, actorId));
    return this.get(id);
  }

  /** A payment entered by mistake: kept, crossed out, and the money counts as owed again. */
  async voidPayment(billId: number, paymentId: number, actorId: number, now = new Date()): Promise<SupplierBillDto> {
    await this.transactions.run(async (repos) => {
      await repos.bills.lock(billId);
      const payment = await repos.bills.findPayment(paymentId);
      if (!payment || payment.bill_id !== billId) throw new NotFoundError(`Payment ${paymentId} is not on bill ${billId}`);
      if (payment.voided_at) throw new ConflictError('This payment was already removed');
      if (payment.method === 'credit') throw new ConflictError('This came from a return or credit. Void that instead.');
      const bill = await openBill(repos, billId);
      await repos.bills.voidPayment(paymentId, actorId, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'bill.payment_voided',
        entityType: 'bill',
        entityId: billId,
        say: { key: 'billPaymentRemoved', params: { ...billWords(bill), payment: Number(payment.amount) } },
        details: { paymentId },
      });
    });
    return this.get(billId);
  }

  /**
   * A bill entered by mistake. Remove its payments first, so money never
   * disappears silently; an expense's own payment goes with it. Stock the bill
   * brought in goes back out, and a return's units come back.
   */
  async void(id: number, note: string, actorId: number, now = new Date()): Promise<SupplierBillDto> {
    await this.transactions.run(async (repos) => {
      await voidBill(repos, id, note, actorId, now);
    });
    return this.get(id);
  }

  async setPhoto(id: number, upload: Buffer | null, actorId: number): Promise<SupplierBillDto> {
    const bill = await this.billRepository.findById(id);
    if (!bill) throw new NotFoundError(`Bill ${id} does not exist`);
    const mediaId = upload ? await this.mediaService.store(null, upload, 'bill') : null;
    await this.transactions.run(async (repos) => {
      await repos.bills.setPhoto(id, mediaId);
      await repos.activityLog.create({
        userId: actorId,
        action: 'bill.updated',
        entityType: 'bill',
        entityId: id,
        say: mediaId ? { key: 'billPhotoAdded', params: billWords(bill) } : { key: 'billPhotoRemoved', params: billWords(bill) },
      });
    });
    await this.mediaService.remove(bill.photo_media_id);
    return this.get(id);
  }

  async repeats(): Promise<BillRepeatDto[]> {
    return (await this.billRepository.findActiveRepeats()).map(toRepeatDto);
  }

  async stopRepeat(id: number, actorId: number, now = new Date()): Promise<void> {
    const rule = await this.billRepository.findRepeat(id);
    if (!rule) throw new NotFoundError(`Repeating bill ${id} does not exist`);
    if (rule.stopped_at) throw new ConflictError('This bill has already stopped repeating');
    await this.transactions.run(async (repos) => {
      await repos.bills.stopRepeat(id, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'expense.repeat_stopped',
        entityType: 'expense',
        entityId: null,
        say: { key: 'expenseStopped', params: { category: rule.category ?? 'other' } },
        details: { repeatId: id },
      });
    });
  }

  /**
   * Makes each monthly bill for every month whose day has come. Called every
   * minute by the server; safe to run twice. Returns how many it made.
   */
  async fillRepeats(now = new Date()): Promise<number> {
    const today = this.today(now);
    let made = 0;
    for (const rule of await this.billRepository.findActiveRepeats()) {
      let next = nextMonthDay(rule.last_filled_on, rule.day_of_month);
      while (next <= today) {
        const day = next;
        await this.transactions.run(async (repos) => {
          if ((await repos.bills.findRepeatBill(rule.id, day)) === undefined) {
            const template = rule.template as RepeatTemplate;
            const id = await createBill(
              repos,
              { ...template, number: null, issuedOn: day, dueOn: template.dueDays === null ? null : addDays(day, template.dueDays) },
              null,
              { today, repeatId: rule.id, quiet: true },
            );
            if (id !== null) made += 1;
          }
          await repos.bills.markRepeatFilled(rule.id, day);
        });
        next = nextMonthDay(day, rule.day_of_month);
      }
    }
    return made;
  }
}

/** A repeat's stored bill: the form's input without its number and dates. */
type RepeatTemplate = Omit<NewBillInput, 'number' | 'issuedOn' | 'dueOn' | 'repeatMonthly' | 'prices'> & { dueDays: number | null };

function checkDates(input: { issuedOn: string; dueOn: string | null }) {
  if (input.dueOn !== null && input.dueOn < input.issuedOn) throw new ValidationError("The due date can't be before the bill's date");
}

/**
 * Pay (part of) a bill from a place, inside a transaction: never more than is
 * left, never on a return or credit, never dated in a filed month. Returns the
 * payment's id.
 */
export async function payBill(
  repos: TransactionalRepositories,
  id: number,
  input: PaymentInput & { groupId?: number | null; supplierId?: number | null },
  actorId: number,
): Promise<number> {
  await repos.bills.lock(id);
  const bill = await openBill(repos, id);
  if (input.supplierId !== undefined && bill.supplier_id !== input.supplierId) throw new ValidationError(`Bill ${id} is from another supplier`);
  if (bill.kind === 'credit') throw new ConflictError("A return or credit isn't paid; it lowers what its bill owes");
  const left = roundMoney(Number(bill.amount) - Number(bill.paid));
  if (left <= 0) throw new ConflictError(`${bill.number ? `Bill ${bill.number}` : 'This bill'} is already paid`);
  if (input.amount > left) throw new ValidationError(`Only ${formatEuro(left)} is left to pay on ${bill.number ? `bill ${bill.number}` : 'this bill'}`);
  await assertMonthsOpen(repos.periods, [input.paidOn]);
  const from = await repos.money.payFrom(input);
  const place = await repos.money.placeOrThrow(from.placeId);
  const paymentId = await repos.bills.addPayment({
    billId: id,
    amount: input.amount,
    paidOn: input.paidOn,
    note: input.note,
    ...from,
    groupId: input.groupId ?? null,
    createdBy: actorId,
  });
  await repos.activityLog.create({
    userId: actorId,
    action: 'bill.paid',
    entityType: 'bill',
    entityId: id,
    say: { key: 'billPaid', params: { ...billWords(bill), paid: input.amount, left: input.amount === left ? 0 : roundMoney(left - input.amount), from: placeWords(place) } },
    details: { paymentId, amount: input.amount, paidOn: input.paidOn, placeId: from.placeId, method: from.method, groupId: input.groupId ?? null, note: input.note },
  });
  return paymentId;
}

async function openBill(repos: TransactionalRepositories, id: number): Promise<BillRecord> {
  const bill = await repos.bills.findById(id);
  if (!bill) throw new NotFoundError(`Bill ${id} does not exist`);
  if (bill.voided_at) throw new ConflictError('This bill was voided');
  return bill;
}

/** The VAT month a bill counts in. */
export const countedMonth = (bill: Pick<BillRecord, 'issued_on' | 'vat_month'>) => bill.vat_month ?? monthOf(bill.issued_on);

/** A bill counted in a filed VAT month can't change: the return it is on has gone to ATK. */
async function assertBillOpen(repos: TransactionalRepositories, bill: BillRecord): Promise<void> {
  await assertMonthsOpen(repos.periods, [countedMonth(bill)]);
}

/** A bill dated in a filed month is still taken, and counted in the next open month (see periodLock). */
async function placeInVatMonth(repos: TransactionalRepositories, id: number, issuedOn: string): Promise<void> {
  await repos.bills.setVatMonth(id, await vatMonthForBill(repos.periods, issuedOn));
}

interface PlannedLine {
  input: BillLineInput;
  row: NewBillLine;
  product: { id: number; name: string; costPrice: number | null; price: number; vatRate: number } | null;
}

interface BillPlan {
  supplier: { id: number; name: string; abroad: boolean } | null;
  abroad: boolean;
  hasGoods: boolean;
  figures: BillFigures;
  lines: PlannedLine[];
  priceAlerts: BillPreviewDto['priceAlerts'];
}

/** Checks the lines and works out what they come to, for the preview and the save alike. */
async function planBill(
  repos: TransactionalRepositories,
  input: Pick<NewBillInput, 'supplierId' | 'lines' | 'pricesIncludeVat' | 'customs' | 'withholdingType'>,
  abroadOverride?: boolean,
): Promise<BillPlan> {
  const lines = input.lines ?? [];
  let supplier: BillPlan['supplier'] = null;
  let usualVat: number | null = null;
  let usualExempt = false;
  if (input.supplierId) {
    const found = await repos.orders.findSupplier(input.supplierId);
    if (!found) throw new NotFoundError(`Supplier ${input.supplierId} does not exist`);
    supplier = { id: found.id, name: found.name, abroad: found.abroad };
    usualVat = found.usualVatRate;
    usualExempt = found.usualVatExempt;
  }
  const abroad = abroadOverride ?? supplier?.abroad ?? false;

  const productIds = [...new Set(lines.filter((line) => line.kind === 'product').map((line) => line.productId!))];
  const products = new Map((await repos.products.findByIds(productIds, true)).map((product) => [product.id, product]));
  for (const line of lines) {
    if (line.kind === 'product') {
      if (!line.productId || !products.has(line.productId)) throw new NotFoundError('One of the products does not exist');
      if (!line.quantity || line.quantity <= 0) throw new ValidationError('Each product needs how many came');
      if (line.unitPrice === null || line.unitPrice === undefined) throw new ValidationError('Each product needs its price');
    } else {
      const categories: readonly string[] = line.kind === 'cost' ? EXPENSE_CATEGORIES : EQUIPMENT_CATEGORIES;
      if (!line.category || !categories.includes(line.category)) throw new ValidationError('Each cost and piece of equipment needs a category');
      if (line.amount === null || line.amount === undefined || line.amount <= 0) throw new ValidationError('Each cost and piece of equipment needs its amount');
    }
  }

  const rateOf = (line: BillLineInput) => {
    if (line.vatExempt) return 0;
    if (line.vatRate !== null && line.vatRate !== undefined) return line.vatRate;
    if (line.kind === 'product') return products.get(line.productId!)!.vat_rate;
    return usualVat ?? 18;
  };
  const exemptOf = (line: BillLineInput) => {
    if (line.vatExempt !== null && line.vatExempt !== undefined) return line.vatExempt;
    if (line.vatRate !== null && line.vatRate !== undefined) return false;
    if (line.kind === 'product') return products.get(line.productId!)!.vat_exempt;
    return usualVat === 0 && usualExempt;
  };
  const hasGoods = lines.some((line) => line.kind !== 'cost');
  const figures = billFigures({
    abroad,
    pricesIncludeVat: input.pricesIncludeVat ?? true,
    withholdingType: input.withholdingType ?? null,
    customs: abroad && hasGoods && input.customs ? { vat: input.customs.vat, duty: input.customs.duty } : null,
    lines: lines.map((line) => ({
      kind: line.kind,
      quantity: line.quantity ?? undefined,
      unitPrice: line.unitPrice ?? undefined,
      amount: line.amount ?? undefined,
      category: line.category ?? null,
      vatRate: rateOf(line),
      productVatRate: line.kind === 'product' ? products.get(line.productId!)!.vat_rate : undefined,
    })),
  });

  const planned: PlannedLine[] = lines.map((line, index) => {
    const lineFigures = figures.lines[index]!;
    const product = line.kind === 'product' ? products.get(line.productId!)! : null;
    return {
      input: line,
      product: product && {
        id: product.id,
        name: product.name,
        costPrice: product.cost_price === null ? null : Number(product.cost_price),
        price: Number(product.base_price),
        vatRate: product.vat_rate,
      },
      row: {
        kind: line.kind,
        productId: product?.id ?? null,
        quantity: product ? line.quantity! : null,
        unitPrice: product ? line.unitPrice! : null,
        category: product ? null : line.category!,
        description: line.description?.trim() || null,
        vatRate: abroad ? 0 : rateOf(line),
        vatExempt: !abroad && exemptOf(line),
        net: lineFigures.net,
        vat: lineFigures.vat,
        landed: lineFigures.landed,
        spread: lineFigures.spread,
        selfVat: lineFigures.selfVat,
        orderLineId: null,
      },
    };
  });

  // A product whose cost goes up: how its margin drops, and a price that keeps it.
  const priceAlerts: BillPreviewDto['priceAlerts'] = [];
  const seen = new Set<number>();
  planned.forEach((line, index) => {
    const unitCost = figures.lines[index]!.unitCost;
    if (!line.product || unitCost === null || seen.has(line.product.id)) return;
    const { costPrice, price } = line.product;
    // Without an earlier cost there is nothing it went up from.
    if (costPrice === null || unitCost <= costPrice) return;
    seen.add(line.product.id);
    const margin = (cost: number) => (price > 0 ? roundMoney(((price - cost) / price) * 100) : 0);
    priceAlerts.push({
      productId: line.product.id,
      name: line.product.name,
      oldCost: costPrice,
      newCost: unitCost,
      price,
      marginBefore: costPrice === null ? null : margin(costPrice),
      marginAfter: margin(unitCost),
      suggestedPrice: costPrice === null ? price : Math.max(price, priceKeepingMargin(costPrice, price, unitCost)),
    });
  });
  return { supplier, abroad, hasGoods, figures, lines: planned, priceAlerts };
}

/**
 * Record a supplier's bill, or an expense paid on the spot. Used on its own,
 * when a delivery is received or a scan confirmed (inside that transaction),
 * and by a monthly repeat. A bill for an order must match the order's
 * supplier. Returns null when a repeat's bill for that day already exists.
 */
export async function createBill(
  repos: TransactionalRepositories,
  input: NewBillInput,
  actorId: number | null,
  options: { today?: string; repeatId?: number; quiet?: boolean } = {},
): Promise<number | null> {
  checkDates(input);
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (!input.supplierId && !input.paidNow) throw new ValidationError('A bill to pay later needs its supplier');
  if (input.paidNow && input.issuedOn > today) throw new ValidationError("Something paid now can't be dated after today");
  if (input.orderId) {
    const order = await repos.orders.findOrder(input.orderId);
    if (!order || order.supplier_id !== input.supplierId) throw new ValidationError('That order is not from this supplier');
  }
  const typed = (input.lines?.length ?? 0) > 0;
  if (!typed && input.amount === undefined) throw new ValidationError('Add at least one line');

  const plan = await planBill(repos, typed ? input : { ...input, lines: [] });
  const { figures, supplier } = plan;
  if (input.supplierId && !supplier) throw new NotFoundError(`Supplier ${input.supplierId} does not exist`);
  let amount: number;
  let vatAmount: number | null;
  let rows: NewBillLine[];
  if (typed) {
    amount = figures.owed;
    vatAmount = figures.paperVat;
    rows = plan.lines.map((line) => line.row);
    if (amount <= 0) throw new ValidationError('The bill has to come to more than 0');
  } else {
    amount = input.amount!;
    vatAmount = input.vatAmount ?? null;
    rows = input.orderId ? await deliveryLines(repos, input.orderId) : [];
  }
  const withholding = typed && input.withholdingType ? input.withholdingType : null;
  const repeatId = options.repeatId ?? (input.repeatMonthly ? await addRepeat(repos, input, plan, amount, actorId) : null);
  const carwashId = input.place === 'carwash' ? (input.carwashId ?? null) : null;

  let id: number;
  try {
    id = await repos.bills.create({
      supplierId: supplier?.id ?? null,
      orderId: input.orderId ?? null,
      number: input.number,
      issuedOn: input.issuedOn,
      dueOn: input.paidNow ? null : input.dueOn,
      amount,
      vatAmount,
      note: input.note,
      createdBy: actorId,
      pricesIncludeVat: input.pricesIncludeVat ?? true,
      abroad: plan.abroad,
      customs: plan.abroad && plan.hasGoods && input.customs && (input.customs.vat > 0 || input.customs.duty > 0) ? input.customs : null,
      withholdingType: withholding,
      withheld: typed ? figures.withheld : 0,
      paidNow: Boolean(input.paidNow),
      place: input.place ?? 'shop',
      carwashId,
      repeatId,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      if (options.repeatId) return null;
      throw new ConflictError('This order already has a bill');
    }
    throw error;
  }
  await repos.bills.addLines(id, rows);
  await placeInVatMonth(repos, id, input.issuedOn);

  const who = supplier?.name ?? null;
  if (typed) {
    // Products typed on the bill come into stock with it, at their new cost.
    for (const line of plan.lines) {
      if (!line.product) continue;
      const product = (await repos.products.findById(line.product.id, true))!;
      await applyStockChange(repos, {
        productId: product.id,
        productName: product.name,
        delta: line.row.quantity!,
        reason: SYSTEM_STOCK_REASONS.DELIVERY,
        notes: `Bill #${id}${who ? ` from ${who}` : ''}`,
        adjustedBy: actorId ?? 0,
        reorderLevel: product.reorder_level ?? 0,
      });
    }
    if (input.updateCosts !== false && actorId !== null) {
      const newCosts = new Map<number, number>();
      plan.lines.forEach((line, index) => {
        const unitCost = figures.lines[index]!.unitCost;
        if (line.product && unitCost !== null) newCosts.set(line.product.id, unitCost);
      });
      for (const [productId, cost] of newCosts) {
        const product = plan.lines.find((line) => line.product?.id === productId)!.product!;
        await changeCost(repos, { productId, productName: product.name, from: product.costPrice, to: cost, actorId, because: { bill: who ?? 'an expense' } });
      }
    }
    for (const change of input.prices ?? []) {
      if (actorId === null) break;
      await setShelfPrice(repos, change.productId, change.price, actorId, who ?? 'an expense');
    }
  }

  if (input.paidNow) {
    const from = await repos.money.payFrom(input.paidNow);
    await repos.bills.addPayment({ billId: id, amount, paidOn: input.issuedOn, ...from, note: null, createdBy: actorId });
  }
  if (supplier && typed) {
    const first = plan.lines[0]!.row;
    const rates = plan.lines.map((line) => line.row.vatRate);
    await repos.bills.rememberForSupplier(supplier.id, {
      kind: first.kind,
      category: plan.lines.find((line) => line.row.kind !== 'product')?.row.category ?? null,
      vatRate: plan.abroad ? null : mostCommon(rates),
      vatExempt: !plan.abroad && plan.lines.every((line) => line.row.vatExempt),
      withholdingType: withholding,
    });
  }
  if (!options.quiet) {
    await repos.activityLog.create({
      userId: actorId,
      action: 'bill.added',
      entityType: 'bill',
      entityId: id,
      say: { key: 'billAdded', params: { amount, supplier: who, number: input.number ?? null, dueOn: input.dueOn ?? null, paidNow: Boolean(input.paidNow) } },
      details: { ...input },
    });
  }
  return id;
}

/** The products a delivery brought, as the lines of its bill (their stock came in with the delivery). */
async function deliveryLines(repos: TransactionalRepositories, orderId: number): Promise<NewBillLine[]> {
  const lines = await repos.orders.findLines([orderId]);
  const products = new Map((await repos.products.findByIds([...new Set(lines.map((line) => line.product_id))], true)).map((product) => [product.id, product]));
  return lines
    .filter((line) => (line.received_quantity ?? 0) > 0)
    .map((line) => {
      const rate = products.get(line.product_id)?.vat_rate ?? 18;
      const gross = roundMoney(line.received_quantity! * Number(line.unit_cost ?? 0));
      const vat = vatOf(gross, rate);
      return {
        kind: 'product' as const,
        productId: line.product_id,
        quantity: line.received_quantity,
        unitPrice: line.unit_cost === null ? null : Number(line.unit_cost),
        category: null,
        description: null,
        vatRate: rate,
        vatExempt: products.get(line.product_id)?.vat_exempt ?? false,
        net: roundMoney(gross - vat),
        vat,
        landed: roundMoney(gross - vat),
        spread: false,
        selfVat: 0,
        orderLineId: line.id,
      };
    });
}

async function addRepeat(repos: TransactionalRepositories, input: NewBillInput, plan: BillPlan, amount: number, actorId: number | null): Promise<number> {
  if (!plan.lines.length || plan.lines.some((line) => line.row.kind !== 'cost')) {
    throw new ValidationError('Only costs like rent, internet or power can repeat every month');
  }
  const { number: _number, issuedOn, dueOn, repeatMonthly: _repeat, prices: _prices, ...rest } = input;
  const template: RepeatTemplate = { ...rest, dueDays: dueOn === null ? null : daysBetween(issuedOn, dueOn) };
  return repos.bills.addRepeat({
    supplierId: input.supplierId,
    template,
    amount,
    category: plan.lines[0]!.row.category,
    place: input.place ?? 'shop',
    carwashId: input.place === 'carwash' ? (input.carwashId ?? null) : null,
    note: input.note,
    dayOfMonth: Math.min(Number(issuedOn.slice(8, 10)), LAST_REPEAT_DAY),
    lastFilledOn: issuedOn,
    createdBy: actorId ?? 0,
  });
}

function mostCommon(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | null = null;
  for (const [value, count] of counts) if (best === null || count > counts.get(best)!) best = value;
  return best;
}

/** A new shelf price chosen from a bill's price alert, written to the product's price history. */
async function setShelfPrice(repos: TransactionalRepositories, productId: number, price: number, actorId: number, supplier: string) {
  const product = await repos.products.findById(productId, true);
  if (!product) throw new NotFoundError(`Product ${productId} does not exist`);
  const from = Number(product.base_price);
  if (from === price) return;
  validatePricingTiers(price, await repos.pricingTiers.findByProductId(productId));
  await repos.orders.setPrice(productId, price);
  await repos.activityLog.create({
    userId: actorId,
    action: 'product.updated',
    entityType: 'product',
    entityId: productId,
    say: { key: 'priceChanged', params: { product: product.name, from, to: price, because: { bill: supplier } } },
    details: { price: { from, to: price } },
  });
}

/**
 * A return or credit from the supplier against one of their bills. It goes
 * against what that bill still owes (as a payment of method "credit"); any
 * more than that, the supplier owes the shop. A return also takes its units
 * back out of stock.
 */
export async function createCredit(repos: TransactionalRepositories, billId: number, input: CreditInput, actorId: number, today: string): Promise<number> {
  await repos.bills.lock(billId);
  const bill = await openBill(repos, billId);
  if (bill.kind === 'credit') throw new ConflictError('A return or credit is made against a bill, not another credit');
  if (!bill.supplier_id) throw new ConflictError('An expense paid on the spot has no supplier to give anything back');
  if (input.issuedOn < bill.issued_on) throw new ValidationError("A return or credit can't be dated before its bill");
  if (input.issuedOn > today) throw new ValidationError("A return or credit can't be dated after today");
  if (input.lines.length === 0) throw new ValidationError('Add at least one line');
  if (input.returnsStock && !input.lines.some((line) => line.kind === 'product')) throw new ValidationError('A return needs the products that went back');

  const plan = await planBill(
    repos,
    { supplierId: bill.supplier_id, lines: input.lines, pricesIncludeVat: input.pricesIncludeVat ?? bill.prices_include_vat, withholdingType: bill.withholding_type, customs: null },
    bill.abroad,
  );
  const amount = plan.figures.owed;
  if (amount <= 0) throw new ValidationError('The return or credit has to come to more than 0');

  // Never more back than the bill was for, nor more units than came on it.
  const credits = (await repos.bills.findCredits(billId)).filter((credit) => !credit.voided_at);
  const creditedBefore = roundMoney(credits.reduce((sum, credit) => sum + Number(credit.amount) + Number(credit.withheld), 0));
  const billTotal = roundMoney(Number(bill.amount) + Number(bill.withheld));
  if (roundMoney(creditedBefore + plan.figures.total) > billTotal) {
    throw new ValidationError(`Only ${formatEuro(roundMoney(billTotal - creditedBefore))} of this bill is left to give back`);
  }
  if (input.returnsStock) {
    const billLines = await repos.bills.findLines([billId]);
    const returnedBefore = await repos.bills.findLines(credits.filter((credit) => credit.returns_stock).map((credit) => credit.id));
    for (const line of plan.lines.filter((planned) => planned.product)) {
      const came = billLines.filter((row) => row.product_id === line.product!.id).reduce((sum, row) => sum + (row.quantity ?? 0), 0);
      const back = returnedBefore.filter((row) => row.product_id === line.product!.id).reduce((sum, row) => sum + (row.quantity ?? 0), 0);
      const now = plan.lines.filter((planned) => planned.product?.id === line.product!.id).reduce((sum, planned) => sum + planned.row.quantity!, 0);
      if (back + now > came) throw new ValidationError(`Only ${came - back} × ${line.product!.name} came on this bill to send back`);
    }
  }

  const id = await repos.bills.create({
    supplierId: bill.supplier_id,
    orderId: null,
    number: input.number,
    issuedOn: input.issuedOn,
    dueOn: null,
    amount,
    vatAmount: plan.figures.paperVat,
    note: input.note,
    createdBy: actorId,
    kind: 'credit',
    creditForId: billId,
    returnsStock: input.returnsStock,
    pricesIncludeVat: input.pricesIncludeVat ?? bill.prices_include_vat,
    abroad: bill.abroad,
    withholdingType: bill.withholding_type,
    withheld: plan.figures.withheld,
    place: bill.place,
    carwashId: bill.carwash_id,
  });
  await repos.bills.addLines(id, plan.lines.map((line) => line.row));
  await placeInVatMonth(repos, id, input.issuedOn);
  if (input.returnsStock) {
    for (const line of plan.lines) {
      if (!line.product) continue;
      const product = (await repos.products.findById(line.product.id, true))!;
      await applyStockChange(repos, {
        productId: product.id,
        productName: product.name,
        delta: -line.row.quantity!,
        reason: SYSTEM_STOCK_REASONS.SUPPLIER_RETURN,
        notes: `Return #${id} to ${bill.supplier_name}`,
        adjustedBy: actorId,
        reorderLevel: product.reorder_level ?? 0,
      });
    }
  }
  const left = roundMoney(Number(bill.amount) - Number(bill.paid));
  const applied = roundMoney(Math.min(amount, left));
  if (applied > 0) {
    await repos.bills.addPayment({ billId, amount: applied, paidOn: input.issuedOn, method: 'credit', placeId: null, note: null, createdBy: actorId, creditId: id });
  }
  await repos.activityLog.create({
    userId: actorId,
    action: 'bill.credited',
    entityType: 'bill',
    entityId: billId,
    say: { key: 'billCredited', params: { ...billWords(bill), credit: amount, returned: input.returnsStock } },
    details: { creditId: id, ...input },
  });
  return id;
}

/** Void a bill (or a return or credit) and undo what it did to stock and to what's owed. */
export async function voidBill(repos: TransactionalRepositories, id: number, note: string, actorId: number, now: Date): Promise<BillRecord> {
  await repos.bills.lock(id);
  const bill = await openBill(repos, id);
  await assertBillOpen(repos, bill);
  const lines = await repos.bills.findLines([id]);
  if (bill.kind === 'credit') {
    for (const payment of await repos.bills.creditPayments(id)) await repos.bills.voidPayment(payment.id, actorId, now);
    if (bill.returns_stock) await moveStock(repos, lines, +1, `Return #${id} voided`, actorId);
  } else {
    if ((await repos.bills.findCredits(id)).some((credit) => !credit.voided_at)) {
      throw new ConflictError('This bill has a return or credit. Void that first.');
    }
    const payments = await repos.bills.standingPayments(id);
    if (bill.paid_now) {
      for (const payment of payments) await repos.bills.voidPayment(payment.id, actorId, now);
    } else if (payments.length > 0) {
      throw new ConflictError('This bill has payments. Remove them first.');
    }
    // Stock typed on the bill came in with it; a delivery's stock stays with its order.
    await moveStock(repos, lines.filter((line) => line.order_line_id === null), -1, `Bill #${id} voided`, actorId);
  }
  await repos.bills.void(id, actorId, note, now);
  await repos.activityLog.create({
    userId: actorId,
    action: 'bill.voided',
    entityType: 'bill',
    entityId: id,
    say: { key: 'billVoided', params: { ...billWords(bill), note } },
  });
  return bill;
}

async function moveStock(repos: TransactionalRepositories, lines: BillLineRecord[], sign: 1 | -1, notes: string, actorId: number) {
  for (const line of lines) {
    if (line.kind !== 'product' || !line.product_id || !line.quantity) continue;
    const product = (await repos.products.findById(line.product_id, true))!;
    await applyStockChange(repos, {
      productId: product.id,
      productName: product.name,
      delta: sign * line.quantity,
      reason: SYSTEM_STOCK_REASONS.UNDO,
      notes,
      adjustedBy: actorId,
      reorderLevel: product.reorder_level ?? 0,
    });
  }
}

/** The values a sentence needs to name a bill: "the €120.00 bill from Fresh Foods (no. FF-1)". */
const billWords = (bill: BillRecord) => ({ amount: Number(bill.amount), supplier: bill.supplier_name, number: bill.number });

const toRepeatDto = (rule: RepeatRecord): BillRepeatDto => ({
  id: rule.id,
  supplier: rule.supplier_id === null ? null : { id: rule.supplier_id, name: rule.supplier_name ?? '' },
  amount: Number(rule.amount),
  category: rule.category,
  place: rule.place,
  carwashId: rule.carwash_id,
  carwashName: rule.carwash_name,
  note: rule.note,
  dayOfMonth: rule.day_of_month,
  addedBy: rule.created_by_name,
});

const toLineDto = (line: BillLineRecord): BillLineDto => ({
  id: line.id,
  kind: line.kind,
  productId: line.product_id,
  productName: line.product_name,
  quantity: line.quantity,
  unitPrice: line.unit_price === null ? null : Number(line.unit_price),
  category: line.category,
  description: line.description,
  vatRate: line.vat_rate,
  vatExempt: line.vat_exempt,
  net: Number(line.net),
  vat: Number(line.vat),
  gross: roundMoney(Number(line.net) + Number(line.vat)),
  landed: Number(line.landed),
  spread: line.spread,
  selfVat: Number(line.self_vat),
  fromDelivery: line.order_line_id !== null,
});

function toDto(bill: BillRecord, payments: PaymentRecord[], lines: BillLineRecord[], credits: BillRecord[], today: string): SupplierBillDto {
  const amount = Number(bill.amount);
  const paid = Number(bill.paid);
  const withheld = Number(bill.withheld);
  const voided = bill.voided_at !== null;
  const isCredit = bill.kind === 'credit';
  const left = voided ? 0 : roundMoney(Math.max(0, amount - paid));
  const status: BillStatus = voided ? 'void' : left === 0 ? 'paid' : paid > 0 ? 'partly_paid' : 'unpaid';
  const daysLeft = !isCredit && left > 0 && bill.due_on ? daysBetween(today, bill.due_on) : null;
  const customsVat = bill.customs_vat === null ? 0 : Number(bill.customs_vat);
  return {
    id: bill.id,
    kind: bill.kind,
    supplier: bill.supplier_id === null ? null : { id: bill.supplier_id, name: bill.supplier_name ?? '' },
    orderId: bill.order_id,
    number: bill.number,
    issuedOn: bill.issued_on,
    vatMonth: bill.vat_month && bill.vat_month.slice(0, 7) !== bill.issued_on.slice(0, 7) ? bill.vat_month.slice(0, 7) : null,
    dueOn: bill.due_on,
    amount,
    total: roundMoney(amount + withheld),
    vatAmount: bill.vat_amount === null ? null : Number(bill.vat_amount),
    vatToClaim: roundMoney((bill.vat_amount === null ? 0 : Number(bill.vat_amount)) + customsVat),
    paid,
    left,
    status,
    overdue: daysLeft !== null && daysLeft < 0,
    daysLeft,
    note: bill.note,
    photoUrl: mediaUrl(bill.photo_media_id),
    recordedBy: bill.created_by_name,
    voidNote: bill.void_note,
    scanId: bill.scan_id,
    paidNow: bill.paid_now,
    pricesIncludeVat: bill.prices_include_vat,
    abroad: bill.abroad,
    customs:
      bill.customs_paid_method === null
        ? null
        : { vat: customsVat, duty: bill.customs_duty === null ? 0 : Number(bill.customs_duty), method: bill.customs_paid_method },
    withholding: bill.withholding_type === null ? null : { type: bill.withholding_type, rate: WITHHOLDING_RATES[bill.withholding_type], amount: withheld },
    place: bill.place,
    carwash: bill.carwash_id === null ? null : { id: bill.carwash_id, name: bill.carwash_name ?? '' },
    repeatId: bill.repeat_id,
    creditFor: bill.credit_for_id === null ? null : { id: bill.credit_for_id, number: bill.credit_for_number },
    returnsStock: bill.returns_stock,
    credits: credits.map((credit) => ({
      id: credit.id,
      number: credit.number,
      issuedOn: credit.issued_on,
      amount: Number(credit.amount),
      returnsStock: credit.returns_stock,
      voided: credit.voided_at !== null,
    })),
    lines: lines.filter((line) => line.bill_id === bill.id).map(toLineDto),
    payments: payments
      .filter((payment) => (isCredit ? payment.credit_id === bill.id : payment.bill_id === bill.id))
      .map((payment) => ({
        id: payment.id,
        billId: payment.bill_id,
        amount: Number(payment.amount),
        paidOn: payment.paid_on,
        method: payment.method,
        place: payment.place_id === null ? null : { id: payment.place_id, kind: payment.place_kind!, name: payment.place_name },
        groupId: payment.group_id,
        credit: payment.credit_id === null ? null : { id: payment.credit_id, number: payment.credit_number },
        note: payment.note,
        recordedBy: payment.created_by_name,
        voided: payment.voided_at !== null,
      })),
  };
}
