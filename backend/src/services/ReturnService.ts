import { returnSerials } from './SerialService.js';
import type { ApprovalStatus, ReturnCondition } from '../constants/approvals.js';
import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { LockedSale, RefundParts, ReturnRecord, ReturnRepository } from '../repositories/ReturnRepository.js';
import { placeWords } from '../repositories/MoneyRepository.js';
import { assertMonthsOpen } from './vat/periodLock.js';
import { validIban } from './MoneyService.js';
import { zonedDay } from '../utils/zonedDates.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import type { PublicUser } from '../types/auth.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { assertPending, closePendingAlerts, notifyAdminsOfPending, notifyRequester } from './approvals/approvalHelpers.js';
import type { DocumentService } from './DocumentService.js';
import { applyStockChange } from './InventoryService.js';
import { toIsoOrNull, toMoney } from './mappers.js';
import type { AppSettings, SettingsService } from './SettingsService.js';
import { approveWriteOff, createWriteOffRecord } from './WriteOffService.js';
import { canOversee } from '../utils/roles.js';
import { en, type ServerMessages } from '../i18n/messages.js';

export interface ReturnInput {
  quantity: number;
  condition: ReturnCondition;
  /** Defaults to what the customer paid for these units. */
  refundAmount?: number;
  notes: string | null;
  /** How the money goes back; left out, all of it comes out of the till (less a tab), as before. */
  refundBy?: {
    card: number;
    transfer: number;
    tab: number | null;
    approvalCode: string | null;
    customerName: string | null;
    iban: string | null;
    batch: string | null;
  };
}

/** How a refund's money went back. */
export interface RefundByDto {
  cash: number;
  card: number;
  transfer: number;
  /** What should come off their tab; null: off the tab first, as much as they owe (returns from before). */
  tab: number | null;
  approvalCode: string | null;
  customerName: string | null;
  iban: string | null;
  /** The day a bank-transfer refund was sent; null while it is still owed. */
  transferSentOn: string | null;
}

/** What the refund screen needs about the sale: its receipt, how it was paid, and whether the owner must say yes first. */
export interface RefundInfoDto {
  saleId: number;
  soldAt: string;
  receiptNumber: string | null;
  paidBy: 'cash' | 'card' | 'split' | 'tab';
  cardAmount: number | null;
  receiptTotal: number | null;
  /** The customer whose tab it went on. */
  tabCustomer: string | null;
  /** Null when this person's returns never wait for the owner. */
  approval: { limit: number; tooOld: boolean } | null;
}

/** A bank-transfer refund still to send: the lines given back together, as one payment. */
export interface RefundToPayDto {
  returnIds: number[];
  customerName: string;
  iban: string | null;
  amount: number;
  day: string;
  receiptNumber: string | null;
}

export interface ReturnDto {
  id: number;
  saleId: number;
  productId: number;
  productName: string;
  quantity: number;
  refundAmount: number;
  condition: ReturnCondition;
  notes: string | null;
  status: ApprovalStatus;
  /** Empty when it went through without the owner. */
  needsApprovalBecause: string[];
  soldBy: { id: number; name: string } | null;
  saleDate: string;
  requestedBy: { id: number; name: string } | null;
  requestedAt: string;
  decidedBy: { id: number; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  refundBy: RefundByDto;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 200;

/**
 * Why an employee's return has to wait for the owner. Admins never wait.
 * Written in English for the record unless another language is given.
 */
export function approvalReasons(
  input: { refundAmount: number; condition: ReturnCondition; saleDate: Date; now: Date },
  settings: AppSettings,
  t: ServerMessages = en,
): string[] {
  const reasons: string[] = [];
  if (input.refundAmount > settings.refundApprovalLimit) reasons.push(t.reasonRefundOver(settings.refundApprovalLimit));
  if (input.now.getTime() - input.saleDate.getTime() > settings.returnWindowDays * MS_PER_DAY) {
    reasons.push(t.reasonSoldDaysAgo(settings.returnWindowDays));
  }
  if (input.condition === 'damaged') reasons.push(t.reasonDamaged);
  return reasons;
}

export class ReturnService {
  constructor(
    private readonly returnRepository: ReturnRepository,
    private readonly settingsService: SettingsService,
    private readonly transactions: TransactionManager,
    private readonly documents: DocumentService,
    private readonly timeZone: string,
  ) {}

  async request(saleId: number, input: ReturnInput, user: PublicUser): Promise<ReturnDto> {
    const settings = await this.settingsService.get();
    const id = await this.transactions.run(async (repos) => {
      const sale = await repos.returns.lockSale(saleId);
      if (!sale) throw new NotFoundError(`Sale ${saleId} does not exist`);
      if (sale.undone_at) throw new ConflictError("This sale was undone, so it can't be returned");
      if (!canOversee(user.role) && sale.sold_by !== user.id) {
        throw new ForbiddenError('You can only return your own sales. Ask the owner to return this one.');
      }
      const refundAmount = validate(sale, input);
      const refundBy = refundParts(input, refundAmount, (await repos.tabs.customerOfSale(saleId)) !== undefined);
      const reasonInput = { refundAmount, condition: input.condition, saleDate: sale.sale_date, now: new Date() };
      const reasons = canOversee(user.role) ? [] : approvalReasons(reasonInput, settings);

      const id = await repos.returns.create({
        saleId,
        quantity: input.quantity,
        refundAmount,
        condition: input.condition,
        notes: input.notes,
        approvalReasons: reasons,
        requestedBy: user.id,
        refundBy,
      });
      const units = { quantity: input.quantity, product: sale.product_name };
      const what = `${units.quantity} × ${units.product}`;
      await repos.activityLog.create({
        userId: user.id,
        action: 'return.requested',
        entityType: 'return',
        entityId: id,
        say: { key: 'returned', params: { ...units, saleId, refund: refundAmount } },
        details: { saleId, quantity: input.quantity, refundAmount, condition: input.condition, approvalReasons: reasons, card: refundBy.card, transfer: refundBy.transfer, tab: refundBy.tab },
      });

      if (reasons.length === 0) {
        await approveReturn(repos, id, user.id, this.documents);
      } else {
        await notifyAdminsOfPending(repos, 'return', { type: 'return', id }, (t) =>
          t.returnPending({ name: user.name, what, reasons: approvalReasons(reasonInput, settings, t) }),
        );
      }
      return id;
    });
    return this.get(id);
  }

  async approve(id: number, admin: PublicUser): Promise<ReturnDto> {
    await this.transactions.run(async (repos) => {
      assertPending(await this.lock(repos, id), 'return');
      await closePendingAlerts(repos, { type: 'return', id });
      await approveReturn(repos, id, admin.id, this.documents);
      const item = (await repos.returns.findById(id))!;
      const units = { quantity: item.quantity, product: item.product_name };
      const what = `${units.quantity} × ${units.product}`;
      await repos.activityLog.create({
        userId: admin.id,
        action: 'return.approved',
        entityType: 'return',
        entityId: id,
        say: { key: 'returnApproved', params: { ...units, refund: toMoney(item.refund_amount) } },
      });
      await notifyRequester(repos, item.requested_by, admin.id, (t) => ({
        title: t.returnApproved(what),
        message: t.returnApprovedMessage,
      }));
    });
    return this.get(id);
  }

  async reject(id: number, admin: PublicUser, note: string): Promise<ReturnDto> {
    await this.transactions.run(async (repos) => {
      assertPending(await this.lock(repos, id), 'return');
      await closePendingAlerts(repos, { type: 'return', id });
      await repos.returns.decide(id, { status: 'rejected', decidedBy: admin.id, note });
      const item = (await repos.returns.findById(id))!;
      const units = { quantity: item.quantity, product: item.product_name };
      const what = `${units.quantity} × ${units.product}`;
      await repos.activityLog.create({
        userId: admin.id,
        action: 'return.rejected',
        entityType: 'return',
        entityId: id,
        say: { key: 'returnRejected', params: { ...units, note } },
      });
      await notifyRequester(repos, item.requested_by, admin.id, (t) => ({ title: t.returnRejected(what), message: note }));
    });
    return this.get(id);
  }

  /** The sale as the refund screen shows it. */
  async refundInfo(saleId: number, user: PublicUser, now = new Date()): Promise<RefundInfoDto> {
    const info = await this.returnRepository.refundInfo(saleId);
    if (!info) throw new NotFoundError(`Sale ${saleId} does not exist`);
    if (!canOversee(user.role) && info.sold_by !== user.id) {
      throw new ForbiddenError('You can only return your own sales. Ask the owner to return this one.');
    }
    const settings = await this.settingsService.get();
    const paidBy: RefundInfoDto['paidBy'] =
      info.payment_method === 'account' || (info.payment_method === null && info.tab_customer !== null)
        ? 'tab'
        : info.payment_method === 'card'
          ? 'card'
          : info.card_amount !== null
            ? 'split'
            : 'cash';
    return {
      saleId,
      soldAt: info.sale_date.toISOString(),
      receiptNumber: info.number,
      paidBy,
      cardAmount: info.card_amount === null ? null : toMoney(info.card_amount),
      receiptTotal: info.total === null ? null : toMoney(info.total),
      tabCustomer: info.tab_customer,
      approval: canOversee(user.role)
        ? null
        : { limit: settings.refundApprovalLimit, tooOld: now.getTime() - info.sale_date.getTime() > settings.returnWindowDays * MS_PER_DAY },
    };
  }

  /** Bank-transfer refunds approved and not sent yet, one per refund (its lines together), oldest first. */
  async refundsToPay(): Promise<RefundToPayDto[]> {
    const rows = await this.returnRepository.transfersOwed();
    return rows.map((row) => ({
      returnIds: row.return_ids,
      customerName: row.customer_name,
      iban: row.iban,
      amount: toMoney(row.amount),
      day: row.day,
      receiptNumber: row.receipt_number,
    }));
  }

  /** Someone sent these bank-transfer refunds: they leave the place on that day. */
  async markRefundsSent(input: { returnIds: number[]; placeId: number; day: string }, actor: PublicUser, now = new Date()): Promise<void> {
    if (input.day > zonedDay(now, this.timeZone)) throw new ValidationError("A transfer can't be dated in the future");
    await this.transactions.run(async (repos) => {
      const rows = await repos.returns.lockTransfers(input.returnIds);
      if (rows.length !== new Set(input.returnIds).size) throw new NotFoundError('One of these refunds does not exist');
      for (const row of rows) {
        if (row.transfer_sent_on !== null) throw new ConflictError('This refund was already marked sent');
        if (row.status !== 'approved' || row.undone_at !== null || Number(row.refund_transfer) <= 0) {
          throw new ConflictError('One of these refunds is not a bank transfer waiting to be sent');
        }
      }
      await assertMonthsOpen(repos.periods, [input.day]);
      const place = await repos.money.placeOrThrow(input.placeId);
      if (place.archived_at) throw new ValidationError('That place is closed; pick another');
      await repos.returns.markTransfersSent(input.returnIds, { day: input.day, placeId: input.placeId, by: actor.id, at: now });
      const amount = roundMoney(rows.reduce((sum, row) => sum + Number(row.refund_transfer), 0));
      await repos.activityLog.create({
        userId: actor.id,
        action: 'return.transfer_sent',
        entityType: 'return',
        entityId: rows[0]!.id,
        say: { key: 'refundSent', params: { name: rows[0]!.refund_to ?? '', amount, place: placeWords(place) } },
        details: { returnIds: input.returnIds, placeId: input.placeId, day: input.day, amount },
      });
    });
  }

  async list(filters: { status?: ApprovalStatus }): Promise<ReturnDto[]> {
    const rows = await this.returnRepository.findMany({ ...filters, limit: LIST_LIMIT });
    return rows.map(toReturnDto);
  }

  private async lock(repos: TransactionalRepositories, id: number) {
    const status = await repos.returns.lockStatus(id);
    if (!status) throw new NotFoundError(`Return ${id} does not exist`);
    return status;
  }

  private async get(id: number): Promise<ReturnDto> {
    const row = await this.returnRepository.findById(id);
    if (!row) throw new NotFoundError(`Return ${id} does not exist`);
    return toReturnDto(row);
  }
}

/** Check the units and refund against the sale; returns the refund to record. */
function validate(sale: LockedSale, input: ReturnInput): number {
  const left = sale.quantity_sold - sale.returned_quantity;
  if (left <= 0) throw new ValidationError('Everything from this sale has already been returned');
  if (input.quantity > left) throw new ValidationError(`Only ${left} left to return from this sale`);

  const paid = roundMoney(input.quantity * toMoney(sale.price_per_unit));
  const refund = input.refundAmount ?? paid;
  if (refund > paid) throw new ValidationError(`The refund can be at most ${formatEuro(paid)}, what was paid for these units`);
  return roundMoney(refund);
}

/** How the money of a new return goes back, checked against the refund and the sale. */
function refundParts(input: ReturnInput, refund: number, onTab: boolean): RefundParts {
  const given = input.refundBy;
  if (!given) return { card: 0, transfer: 0, tab: null, approvalCode: null, customerName: null, iban: null, batch: null };
  const card = roundMoney(given.card);
  const transfer = roundMoney(given.transfer);
  const tab = given.tab === null ? null : roundMoney(given.tab);
  const parts = roundMoney(card + transfer + (tab ?? 0));
  if (parts > refund) throw new ValidationError(`The ways the money goes back come to ${formatEuro(parts)}, more than the refund of ${formatEuro(refund)}`);
  if ((tab ?? 0) > 0 && !onTab) throw new ValidationError("This sale wasn't put on a tab, so nothing can come off one");
  if (transfer > 0 && !given.customerName) throw new ValidationError('Say who the bank transfer goes to');
  const iban = given.iban ? given.iban.replace(/\s+/g, '').toUpperCase() : null;
  if (transfer > 0 && iban && !validIban(iban)) throw new ValidationError("That IBAN isn't right; check it, or leave it empty");
  return {
    card,
    transfer,
    tab,
    approvalCode: card > 0 ? given.approvalCode : null,
    customerName: given.customerName,
    iban: transfer > 0 ? iban : null,
    batch: given.batch,
  };
}

/**
 * Apply an approved return: resellable units go back on the shelf; damaged
 * ones become an approved write-off so the loss is valued; the refund gets a
 * credit note against the sale's invoice. Must run in a transaction.
 */
async function approveReturn(repos: TransactionalRepositories, id: number, decidedBy: number, documents: DocumentService): Promise<void> {
  const item = await repos.returns.findById(id);
  if (!item) throw new NotFoundError(`Return ${id} does not exist`);

  if (item.condition === 'resellable') {
    const product = await repos.products.findById(item.product_id, true);
    await applyStockChange(repos, {
      productId: item.product_id,
      productName: item.product_name,
      delta: item.quantity,
      reason: SYSTEM_STOCK_REASONS.RETURN,
      notes: `Return #${id}`,
      adjustedBy: decidedBy,
      reorderLevel: product?.reorder_level ?? 0,
      locationId: null,
    });
  } else {
    const writeOff = await createWriteOffRecord(repos, {
      productId: item.product_id,
      quantity: item.quantity,
      reason: 'damaged',
      notes: `Came back damaged (return #${id})`,
      returnId: id,
      requestedBy: decidedBy,
    });
    await approveWriteOff(repos, writeOff.id, decidedBy, { removeStock: false });
  }
  await repos.returns.decide(id, { status: 'approved', decidedBy, note: null });
  // Bought on a tab: the refund comes off what they owe (the part chosen, or all of it on returns
  // from before), and only what's left over is paid out in cash.
  const customerId = await repos.tabs.customerOfSale(item.sale_id);
  const wanted = item.refund_tab === null ? toMoney(item.refund_amount) : toMoney(item.refund_tab);
  if (customerId !== undefined && wanted > 0) {
    const offTab = Math.min(wanted, await repos.tabs.balance(customerId));
    if (offTab > 0) {
      await repos.tabs.addEntry({
        customerId,
        kind: 'refund',
        amount: offTab,
        note: `${item.quantity} × ${item.product_name}`,
        saleId: null,
        returnId: id,
        createdBy: decidedBy,
      });
    }
  }
  await returnSerials(repos, item.sale_id, item.quantity, new Date());
  await documents.followUp(repos, 'credit_note', {
    saleId: item.sale_id,
    returnId: id,
    quantity: item.quantity,
    total: toMoney(item.refund_amount),
    reason: item.notes,
    issuedBy: decidedBy,
  });
}

export function toReturnDto(row: ReturnRecord): ReturnDto {
  return {
    id: row.id,
    saleId: row.sale_id,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    refundAmount: toMoney(row.refund_amount),
    condition: row.condition,
    notes: row.notes,
    status: row.status,
    needsApprovalBecause: row.approval_reasons,
    soldBy: row.sold_by === null ? null : { id: row.sold_by, name: row.sold_by_name ?? 'Unknown' },
    saleDate: row.sale_date.toISOString(),
    requestedBy: row.requested_by === null ? null : { id: row.requested_by, name: row.requested_by_name ?? 'Unknown' },
    requestedAt: row.requested_at.toISOString(),
    decidedBy: row.decided_by === null ? null : { id: row.decided_by, name: row.decided_by_name ?? 'Unknown' },
    decidedAt: toIsoOrNull(row.decided_at),
    decisionNote: row.decision_note,
    refundBy: refundByOf(row),
  };
}

export function refundByOf(row: ReturnRecord): RefundByDto {
  const refund = toMoney(row.refund_amount);
  const card = toMoney(row.refund_card);
  const transfer = toMoney(row.refund_transfer);
  const tab = row.refund_tab === null ? null : toMoney(row.refund_tab);
  return {
    cash: roundMoney(refund - card - transfer - (tab ?? 0)),
    card,
    transfer,
    tab,
    approvalCode: row.card_approval_code,
    customerName: row.refund_to,
    iban: row.refund_iban,
    transferSentOn: row.transfer_sent_on,
  };
}
