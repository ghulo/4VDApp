import type { ApprovalStatus, WriteOffReason } from '../constants/approvals.js';
import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import type { WriteOffRecord, WriteOffRepository } from '../repositories/WriteOffRepository.js';
import type { PublicUser } from '../types/auth.js';
import { roundMoney } from '../utils/money.js';
import { assertPending, closePendingAlerts, notifyAdminsOfPending, notifyRequester } from './approvals/approvalHelpers.js';
import { applyStockChange } from './InventoryService.js';
import { toIsoOrNull, toMoneyOrNull } from './mappers.js';
import { canOversee } from '../utils/roles.js';

export interface WriteOffInput {
  productId: number;
  quantity: number;
  reason: WriteOffReason;
  notes: string | null;
}

export interface WriteOffDto {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  reason: WriteOffReason;
  unitCost: number | null;
  /** Value at cost, or null when the product had no cost price. */
  value: number | null;
  returnId: number | null;
  notes: string | null;
  status: ApprovalStatus;
  requestedBy: { id: number; name: string } | null;
  requestedAt: string;
  decidedBy: { id: number; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

const LIST_LIMIT = 200;

/**
 * Save a pending write-off, capturing today's cost price so the loss value
 * never changes later. Must run in a transaction.
 */
export async function createWriteOffRecord(
  repos: TransactionalRepositories,
  input: WriteOffInput & { returnId: number | null; requestedBy: number },
): Promise<{ id: number; productName: string }> {
  const product = await repos.products.findById(input.productId, true);
  if (!product) throw new NotFoundError(`Product ${input.productId} does not exist`);
  const id = await repos.writeOffs.create({
    productId: product.id,
    quantity: input.quantity,
    reason: input.reason,
    unitCost: toMoneyOrNull(product.cost_price),
    returnId: input.returnId,
    notes: input.notes,
    requestedBy: input.requestedBy,
  });
  return { id, productName: product.name };
}

/**
 * Mark a write-off approved. With `removeStock`, also take the units out of
 * stock (a damaged return skips this: those units never came back in).
 * Must run in a transaction.
 */
export async function approveWriteOff(
  repos: TransactionalRepositories,
  id: number,
  decidedBy: number,
  { removeStock }: { removeStock: boolean },
): Promise<void> {
  const writeOff = await repos.writeOffs.findById(id);
  if (!writeOff) throw new NotFoundError(`Write-off ${id} does not exist`);

  if (removeStock) {
    const product = await repos.products.findById(writeOff.product_id, true);
    try {
      await applyStockChange(repos, {
        productId: writeOff.product_id,
        productName: writeOff.product_name,
        delta: -writeOff.quantity,
        reason: SYSTEM_STOCK_REASONS.WRITE_OFF,
        notes: `Write-off #${id} (${writeOff.reason})`,
        adjustedBy: decidedBy,
        reorderLevel: product?.reorder_level ?? 0,
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        const left = product?.quantity_on_hand ?? 0;
        throw new ConflictError(`Only ${left} left in stock. Count it again or reject this write-off.`);
      }
      throw error;
    }
  }
  await repos.writeOffs.decide(id, { status: 'approved', decidedBy, note: null });
}

export class WriteOffService {
  constructor(
    private readonly writeOffRepository: WriteOffRepository,
    private readonly transactions: TransactionManager,
  ) {}

  /** Admins' write-offs apply straight away; employees' wait for approval. */
  async request(input: WriteOffInput, user: PublicUser): Promise<WriteOffDto> {
    const id = await this.transactions.run(async (repos) => {
      const product = await repos.products.findById(input.productId, true);
      const inStock = product?.quantity_on_hand ?? 0;
      if (product && input.quantity > inStock) {
        throw new ValidationError(`Only ${inStock} in stock, so at most ${inStock} can be written off`);
      }
      const { id, productName } = await createWriteOffRecord(repos, { ...input, returnId: null, requestedBy: user.id });
      const what = `${input.quantity} × ${productName} (${input.reason})`;
      await repos.activityLog.create({
        userId: user.id,
        action: 'write_off.requested',
        entityType: 'write_off',
        entityId: id,
        summary: `Reported ${what}`,
        details: { productId: input.productId, quantity: input.quantity, reason: input.reason, notes: input.notes },
      });
      if (canOversee(user.role)) {
        await approveWriteOff(repos, id, user.id, { removeStock: true });
      } else {
        await notifyAdminsOfPending(repos, 'write-off', { type: 'write_off', id }, (t) =>
          t.writeOffPending({
            name: user.name,
            what: `${input.quantity} × ${productName} (${t.writeOffReason[input.reason] ?? input.reason})`,
          }),
        );
      }
      return id;
    });
    return this.get(id);
  }

  async approve(id: number, admin: PublicUser): Promise<WriteOffDto> {
    await this.transactions.run(async (repos) => {
      assertPending(await this.lock(repos, id), 'write-off');
      await closePendingAlerts(repos, { type: 'write_off', id });
      await approveWriteOff(repos, id, admin.id, { removeStock: true });
      const writeOff = (await repos.writeOffs.findById(id))!;
      const what = `${writeOff.quantity} × ${writeOff.product_name}`;
      await repos.activityLog.create({
        userId: admin.id,
        action: 'write_off.approved',
        entityType: 'write_off',
        entityId: id,
        summary: `Approved the write-off of ${what}`,
      });
      await notifyRequester(repos, writeOff.requested_by, admin.id, (t) => ({
        title: t.writeOffApproved(what),
        message: t.writeOffApprovedMessage,
      }));
    });
    return this.get(id);
  }

  async reject(id: number, admin: PublicUser, note: string): Promise<WriteOffDto> {
    await this.transactions.run(async (repos) => {
      assertPending(await this.lock(repos, id), 'write-off');
      await closePendingAlerts(repos, { type: 'write_off', id });
      await repos.writeOffs.decide(id, { status: 'rejected', decidedBy: admin.id, note });
      const writeOff = (await repos.writeOffs.findById(id))!;
      const what = `${writeOff.quantity} × ${writeOff.product_name}`;
      await repos.activityLog.create({
        userId: admin.id,
        action: 'write_off.rejected',
        entityType: 'write_off',
        entityId: id,
        summary: `Rejected the write-off of ${what}: ${note}`,
      });
      await notifyRequester(repos, writeOff.requested_by, admin.id, (t) => ({ title: t.writeOffRejected(what), message: note }));
    });
    return this.get(id);
  }

  async list(filters: { status?: ApprovalStatus }): Promise<WriteOffDto[]> {
    const rows = await this.writeOffRepository.findMany({ ...filters, limit: LIST_LIMIT });
    return rows.map(toWriteOffDto);
  }

  private async lock(repos: TransactionalRepositories, id: number) {
    const status = await repos.writeOffs.lockStatus(id);
    if (!status) throw new NotFoundError(`Write-off ${id} does not exist`);
    return status;
  }

  private async get(id: number): Promise<WriteOffDto> {
    const row = await this.writeOffRepository.findById(id);
    if (!row) throw new NotFoundError(`Write-off ${id} does not exist`);
    return toWriteOffDto(row);
  }
}

export function toWriteOffDto(row: WriteOffRecord): WriteOffDto {
  const unitCost = toMoneyOrNull(row.unit_cost);
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    reason: row.reason,
    unitCost,
    value: unitCost === null ? null : roundMoney(unitCost * row.quantity),
    returnId: row.return_id,
    notes: row.notes,
    status: row.status,
    requestedBy: row.requested_by === null ? null : { id: row.requested_by, name: row.requested_by_name ?? 'Unknown' },
    requestedAt: row.requested_at.toISOString(),
    decidedBy: row.decided_by === null ? null : { id: row.decided_by, name: row.decided_by_name ?? 'Unknown' },
    decidedAt: toIsoOrNull(row.decided_at),
    decisionNote: row.decision_note,
  };
}
