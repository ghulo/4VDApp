import { ConflictError, NotFoundError } from '../errors/httpErrors.js';
import type { BinRepository } from '../repositories/BinRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';
import type { AttachmentRepository } from '../repositories/AttachmentRepository.js';
import { type AttachmentDto, type AttachmentService, BIN_DAYS, toAttachmentDto } from './AttachmentService.js';
import type { ExpenseService } from './ExpenseService.js';

export type BinKind = 'product' | 'supplier' | 'customer' | 'expense' | 'file';

export interface BinItemDto {
  kind: BinKind;
  id: number;
  name: string;
  /** A barcode, NUI, phone, amount, or for a file what it was on. */
  detail: string | null;
  file: AttachmentDto | null;
  removedAt: string;
  /** The day it leaves the bin. */
  leavesOn: string;
}

/**
 * The recycle bin: what was removed in the last {@link BIN_DAYS} days, with a
 * way back. Products, suppliers and customers were only ever hidden (sales,
 * bills and the books still point at them), so after the bin they stay hidden
 * for good. Files are really deleted then. Issued invoices are never here:
 * the law has a credit note correct them instead.
 */
export class BinService {
  constructor(
    private readonly repository: BinRepository,
    private readonly attachments: AttachmentRepository,
    private readonly attachmentService: AttachmentService,
    private readonly expenseService: ExpenseService,
    private readonly transactions: TransactionManager,
  ) {}

  async list(now = new Date()): Promise<BinItemDto[]> {
    const since = new Date(now.getTime() - BIN_DAYS * 86_400_000);
    const leaves = (removed: Date) => new Date(removed.getTime() + BIN_DAYS * 86_400_000).toISOString();
    const [records, files] = await Promise.all([this.repository.removedSince(since), this.attachments.removedSince(since)]);
    const items: BinItemDto[] = [
      ...records.map((row) => ({ kind: row.kind, id: row.id, name: row.name, detail: row.detail, file: null, removedAt: row.removed_at.toISOString(), leavesOn: leaves(row.removed_at) })),
      ...files.map((row) => ({
        kind: 'file' as const,
        id: row.id,
        name: row.name,
        detail: null,
        file: toAttachmentDto(row),
        removedAt: row.removed_at!.toISOString(),
        leavesOn: leaves(row.removed_at!),
      })),
    ];
    return items.sort((a, b) => b.removedAt.localeCompare(a.removedAt));
  }

  async restore(kind: BinKind, id: number, actorId: number): Promise<void> {
    if (kind === 'file') {
      await this.attachmentService.restore(id, actorId);
      return;
    }
    if (kind === 'expense') {
      await this.restoreExpense(id, actorId);
      return;
    }
    const removed = await this.repository.findRemoved(kind, id);
    if (!removed) throw new NotFoundError('That is not in the recycle bin');
    try {
      await this.transactions.run(async (repos) => {
        await repos.bin.restore(kind, id);
        await repos.activityLog.create({
          userId: actorId,
          action: `${kind}.restored`,
          entityType: kind,
          entityId: id,
          say: { key: 'restoredFromBin', params: { kind, name: removed.name } },
          details: null,
        });
      });
    } catch (error) {
      // Another product took its barcode, code or scale number while it was away.
      if (isUniqueViolation(error)) throw new ConflictError(`${removed.name} can't come back: another product now uses its barcode, code or scale number. Change that one first.`);
      throw error;
    }
  }

  /**
   * An expense comes back as a new one, the same in every way, because its
   * old bill and payment were voided in the books. Its month must still be open.
   */
  private async restoreExpense(id: number, actorId: number): Promise<void> {
    const old = await this.repository.findRemovedExpense(id);
    if (!old) throw new NotFoundError('That expense is not in the recycle bin');
    const again = await this.expenseService.add(
      {
        day: old.day,
        amount: Number(old.amount),
        category: old.category,
        place: old.place,
        ...(old.carwash_id !== null && { carwashId: old.carwash_id }),
        supplierId: old.supplier_id,
        note: old.note,
        repeatMonthly: false,
      },
      actorId,
    );
    await this.transactions.run(async (repos) => {
      await repos.bin.markExpenseRestored(old.bill_id);
      await repos.activityLog.create({
        userId: actorId,
        action: 'expense.restored',
        entityType: 'expense',
        entityId: again.id,
        say: { key: 'restoredFromBin', params: { kind: 'expense', name: old.category } },
        details: { from: id, to: again.id },
      });
    });
  }
}
