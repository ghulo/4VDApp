import type { ApprovalStatus, ReturnCondition } from '../constants/approvals.js';
import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { LockedSale, ReturnRecord, ReturnRepository } from '../repositories/ReturnRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import type { PublicUser } from '../types/auth.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { assertPending, notifyAdminsOfPending, notifyRequester } from './approvals/approvalHelpers.js';
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
      });
      const what = `${input.quantity} × ${sale.product_name}`;
      await repos.activityLog.create({
        userId: user.id,
        action: 'return.requested',
        entityType: 'return',
        entityId: id,
        summary: `Returned ${what} from sale #${saleId}, refund ${formatEuro(refundAmount)}`,
        details: { saleId, quantity: input.quantity, refundAmount, condition: input.condition, approvalReasons: reasons },
      });

      if (reasons.length === 0) {
        await approveReturn(repos, id, user.id);
      } else {
        await notifyAdminsOfPending(repos, 'return', (t) =>
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
      await approveReturn(repos, id, admin.id);
      const item = (await repos.returns.findById(id))!;
      const what = `${item.quantity} × ${item.product_name}`;
      await repos.activityLog.create({
        userId: admin.id,
        action: 'return.approved',
        entityType: 'return',
        entityId: id,
        summary: `Approved the return of ${what}, refund ${formatEuro(toMoney(item.refund_amount))}`,
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
      await repos.returns.decide(id, { status: 'rejected', decidedBy: admin.id, note });
      const item = (await repos.returns.findById(id))!;
      const what = `${item.quantity} × ${item.product_name}`;
      await repos.activityLog.create({
        userId: admin.id,
        action: 'return.rejected',
        entityType: 'return',
        entityId: id,
        summary: `Rejected the return of ${what}: ${note}`,
      });
      await notifyRequester(repos, item.requested_by, admin.id, (t) => ({ title: t.returnRejected(what), message: note }));
    });
    return this.get(id);
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

/**
 * Apply an approved return: resellable units go back on the shelf; damaged
 * ones become an approved write-off so the loss is valued. Must run in a transaction.
 */
async function approveReturn(repos: TransactionalRepositories, id: number, decidedBy: number): Promise<void> {
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
  };
}
