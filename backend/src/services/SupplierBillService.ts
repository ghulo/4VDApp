import type { SupplierPaymentMethod } from '../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { BillFilters, BillRecord, PaymentRecord, SupplierBillRepository } from '../repositories/SupplierBillRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { zonedDay } from '../utils/zonedDates.js';
import { mediaUrl } from './mappers.js';
import type { MediaService } from './MediaService.js';

/** A bill due within this many days counts as "due soon". */
export const BILL_DUE_SOON_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type BillStatus = 'unpaid' | 'partly_paid' | 'paid' | 'void';

export interface SupplierPaymentDto {
  id: number;
  amount: number;
  paidOn: string;
  method: SupplierPaymentMethod;
  note: string | null;
  recordedBy: string | null;
  voided: boolean;
}

export interface SupplierBillDto {
  id: number;
  supplier: { id: number; name: string };
  orderId: number | null;
  /** The supplier's own invoice number. */
  number: string | null;
  issuedOn: string;
  dueOn: string | null;
  amount: number;
  paid: number;
  /** What is still owed; 0 once paid or voided. */
  left: number;
  status: BillStatus;
  /** Money still owed and the due date has passed. */
  overdue: boolean;
  /** Days until due (negative once late); null without a due date or once settled. */
  daysLeft: number | null;
  note: string | null;
  photoUrl: string | null;
  recordedBy: string | null;
  voidNote: string | null;
  payments: SupplierPaymentDto[];
}

export interface BillInput {
  number: string | null;
  issuedOn: string;
  dueOn: string | null;
  amount: number;
  note: string | null;
}

export interface NewBillInput extends BillInput {
  supplierId: number;
  orderId?: number | null;
}

export interface PaymentInput {
  amount: number;
  paidOn: string;
  method: SupplierPaymentMethod;
  note: string | null;
}

export interface PayablesSummary {
  /** Everything still owed. */
  owed: number;
  overdue: { count: number; amount: number };
  dueSoon: { count: number; amount: number };
  bySupplier: Array<{ supplierId: number; name: string; owed: number; overdue: number; bills: number }>;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);

/**
 * What the shop owes its suppliers: each bill they send, paid at once or in
 * parts. Drawer payments come out of the till, so the cash check expects less.
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
    const payments = await this.billRepository.findPayments(bills.map((bill) => bill.id));
    return bills.map((bill) => toDto(bill, payments, this.today(now)));
  }

  async get(id: number, now = new Date()): Promise<SupplierBillDto> {
    const bill = await this.billRepository.findById(id);
    if (!bill) throw new NotFoundError(`Bill ${id} does not exist`);
    return toDto(bill, await this.billRepository.findPayments([id]), this.today(now));
  }

  /** Totals for the Bills page, the reports and the attention list. */
  async summary(now = new Date()): Promise<PayablesSummary> {
    const open = await this.list({ status: 'open' }, now);
    const bySupplier = new Map<number, PayablesSummary['bySupplier'][number]>();
    for (const bill of open) {
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

  async create(input: NewBillInput, actorId: number): Promise<SupplierBillDto> {
    const id = await this.transactions.run((repos) => createBill(repos, input, actorId));
    return this.get(id);
  }

  /** Correct a typo. The amount can't drop below what is already paid. */
  async update(id: number, input: BillInput, actorId: number): Promise<SupplierBillDto> {
    await this.transactions.run(async (repos) => {
      await repos.bills.lock(id);
      const bill = await this.openBill(repos, id);
      checkDates(input);
      if (input.amount < Number(bill.paid)) {
        throw new ValidationError(`The amount can't be less than the ${formatEuro(Number(bill.paid))} already paid`);
      }
      await repos.bills.update(id, input);
      await repos.activityLog.create({
        userId: actorId,
        action: 'bill.updated',
        entityType: 'bill',
        entityId: id,
        summary: `Edited ${describe(bill)}`,
        details: { from: { number: bill.number, issuedOn: bill.issued_on, dueOn: bill.due_on, amount: Number(bill.amount), note: bill.note }, to: input },
      });
    });
    return this.get(id);
  }

  async pay(id: number, input: PaymentInput, actorId: number, now = new Date()): Promise<SupplierBillDto> {
    if (input.paidOn > this.today(now)) throw new ValidationError("paidOn can't be in the future");
    await this.transactions.run(async (repos) => {
      await repos.bills.lock(id);
      const bill = await this.openBill(repos, id);
      const left = roundMoney(Number(bill.amount) - Number(bill.paid));
      if (left <= 0) throw new ConflictError('This bill is already paid');
      if (input.amount > left) throw new ValidationError(`Only ${formatEuro(left)} is left to pay on this bill`);
      const paymentId = await repos.bills.addPayment({ billId: id, ...input, createdBy: actorId });
      await repos.activityLog.create({
        userId: actorId,
        action: 'bill.paid',
        entityType: 'bill',
        entityId: id,
        summary: `Paid ${formatEuro(input.amount)} on ${describe(bill)}${input.amount === left ? ' (paid in full)' : `, ${formatEuro(roundMoney(left - input.amount))} left`}`,
        details: { paymentId, ...input },
      });
    });
    return this.get(id);
  }

  /** A payment entered by mistake: kept, crossed out, and the money counts as owed again. */
  async voidPayment(billId: number, paymentId: number, actorId: number, now = new Date()): Promise<SupplierBillDto> {
    await this.transactions.run(async (repos) => {
      await repos.bills.lock(billId);
      const payment = await repos.bills.findPayment(paymentId);
      if (!payment || payment.bill_id !== billId) throw new NotFoundError(`Payment ${paymentId} is not on bill ${billId}`);
      if (payment.voided_at) throw new ConflictError('This payment was already removed');
      const bill = await this.openBill(repos, billId);
      await repos.bills.voidPayment(paymentId, actorId, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'bill.payment_voided',
        entityType: 'bill',
        entityId: billId,
        summary: `Removed a ${formatEuro(Number(payment.amount))} payment from ${describe(bill)}`,
        details: { paymentId },
      });
    });
    return this.get(billId);
  }

  /** A bill entered by mistake. Remove its payments first, so money never disappears silently. */
  async void(id: number, note: string, actorId: number, now = new Date()): Promise<SupplierBillDto> {
    await this.transactions.run(async (repos) => {
      await repos.bills.lock(id);
      const bill = await this.openBill(repos, id);
      if (Number(bill.paid) > 0) throw new ConflictError('This bill has payments. Remove them first.');
      await repos.bills.void(id, actorId, note, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'bill.voided',
        entityType: 'bill',
        entityId: id,
        summary: `Voided ${describe(bill)}: ${note}`,
      });
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
        summary: `${mediaId ? 'Added a photo to' : 'Removed the photo from'} ${describe(bill)}`,
      });
    });
    await this.mediaService.remove(bill.photo_media_id);
    return this.get(id);
  }

  private async openBill(repos: TransactionalRepositories, id: number): Promise<BillRecord> {
    const bill = await repos.bills.findById(id);
    if (!bill) throw new NotFoundError(`Bill ${id} does not exist`);
    if (bill.voided_at) throw new ConflictError('This bill was voided');
    return bill;
  }
}

function checkDates(input: { issuedOn: string; dueOn: string | null }) {
  if (input.dueOn !== null && input.dueOn < input.issuedOn) throw new ValidationError("The due date can't be before the bill's date");
}

/**
 * Record a supplier's bill. Used on its own and when a delivery is received,
 * inside that transaction. A bill for an order must match the order's supplier.
 */
export async function createBill(repos: TransactionalRepositories, input: NewBillInput, actorId: number): Promise<number> {
  checkDates(input);
  const supplier = await repos.orders.findSupplier(input.supplierId);
  if (!supplier) throw new NotFoundError(`Supplier ${input.supplierId} does not exist`);
  if (input.orderId) {
    const order = await repos.orders.findOrder(input.orderId);
    if (!order || order.supplier_id !== input.supplierId) throw new ValidationError('That order is not from this supplier');
  }
  let id: number;
  try {
    id = await repos.bills.create({ ...input, orderId: input.orderId ?? null, createdBy: actorId });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('This order already has a bill');
    throw error;
  }
  await repos.activityLog.create({
    userId: actorId,
    action: 'bill.added',
    entityType: 'bill',
    entityId: id,
    summary: `Added a ${formatEuro(input.amount)} bill from ${supplier.name}${input.number ? ` (no. ${input.number})` : ''}${input.dueOn ? `, due ${input.dueOn}` : ''}`,
    details: { ...input },
  });
  return id;
}

const describe = (bill: BillRecord) => `the ${formatEuro(Number(bill.amount))} bill from ${bill.supplier_name}${bill.number ? ` (no. ${bill.number})` : ''}`;

function toDto(bill: BillRecord, payments: PaymentRecord[], today: string): SupplierBillDto {
  const amount = Number(bill.amount);
  const paid = Number(bill.paid);
  const voided = bill.voided_at !== null;
  const left = voided ? 0 : roundMoney(Math.max(0, amount - paid));
  const status: BillStatus = voided ? 'void' : left === 0 ? 'paid' : paid > 0 ? 'partly_paid' : 'unpaid';
  const daysLeft = left > 0 && bill.due_on ? daysBetween(today, bill.due_on) : null;
  return {
    id: bill.id,
    supplier: { id: bill.supplier_id, name: bill.supplier_name },
    orderId: bill.order_id,
    number: bill.number,
    issuedOn: bill.issued_on,
    dueOn: bill.due_on,
    amount,
    paid,
    left,
    status,
    overdue: daysLeft !== null && daysLeft < 0,
    daysLeft,
    note: bill.note,
    photoUrl: mediaUrl(bill.photo_media_id),
    recordedBy: bill.created_by_name,
    voidNote: bill.void_note,
    payments: payments
      .filter((payment) => payment.bill_id === bill.id)
      .map((payment) => ({
        id: payment.id,
        amount: Number(payment.amount),
        paidOn: payment.paid_on,
        method: payment.method,
        note: payment.note,
        recordedBy: payment.created_by_name,
        voided: payment.voided_at !== null,
      })),
  };
}
