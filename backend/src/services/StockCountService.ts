import type { CountLineStatus, CountStatus } from '../constants/approvals.js';
import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { CountProductRow, StockCountRecord, StockCountRepository } from '../repositories/StockCountRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import type { PublicUser } from '../types/auth.js';
import { roundMoney } from '../utils/money.js';
import { assertPending, notifyAdminsOfPending, notifyRequester } from './approvals/approvalHelpers.js';
import { applyStockChange } from './InventoryService.js';
import { toIsoOrNull, toMoneyOrNull } from './mappers.js';

export interface StockCountLineDto {
  productId: number;
  productName: string;
  sku: string | null;
  categoryName: string;
  /** Null until counted. */
  countedQuantity: number | null;
  status: CountLineStatus | null;
  decisionNote: string | null;
  // Only for admins, or once the count is closed, so employees count what is really there.
  expectedQuantity?: number;
  difference?: number;
  /** Difference at cost price; null when the product has no cost price. */
  value?: number | null;
}

export interface StockCountSummaryDto {
  id: number;
  category: { id: number; name: string } | null;
  status: CountStatus;
  startedBy: { id: number; name: string } | null;
  startedAt: string;
  submittedAt: string | null;
  closedAt: string | null;
}

export interface StockCountDto extends StockCountSummaryDto {
  totals: {
    products: number;
    counted: number;
    // Hidden (null) from employees until the count is closed.
    differences: number | null;
    pending: number | null;
    /** Value at cost of what is missing; negative when there is more than expected. */
    shortageValue: number | null;
  };
  lines: StockCountLineDto[];
}

const RECENT_CLOSED_COUNTS = 20;

export class StockCountService {
  constructor(
    private readonly stockCountRepository: StockCountRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async start(categoryId: number | null, user: PublicUser): Promise<StockCountDto> {
    const id = await this.transactions.run(async (repos) => {
      await repos.stockCounts.lockStarts();
      if (categoryId !== null && !(await repos.categories.findById(categoryId))) {
        throw new NotFoundError(`Category ${categoryId} does not exist`);
      }
      const overlapping = await repos.stockCounts.findOverlapping(categoryId);
      if (overlapping) {
        throw new ConflictError(
          `A count of ${scopeLabel(overlapping)} is already ${overlapping.status === 'open' ? 'in progress' : 'waiting for approval'}. Finish that one first.`,
        );
      }
      const id = await repos.stockCounts.create(categoryId, user.id);
      const count = (await repos.stockCounts.findById(id))!;
      await repos.activityLog.create({
        userId: user.id,
        action: 'count.started',
        entityType: 'stock_count',
        entityId: id,
        summary: `Started a stock count of ${scopeLabel(count)}`,
      });
      return id;
    });
    return this.get(id, user);
  }

  async list(): Promise<StockCountSummaryDto[]> {
    const counts = await this.stockCountRepository.findRecent(RECENT_CLOSED_COUNTS);
    return counts.map(toSummaryDto);
  }

  async get(id: number, user: PublicUser): Promise<StockCountDto> {
    const count = await this.stockCountRepository.findById(id);
    if (!count) throw new NotFoundError(`Stock count ${id} does not exist`);
    const products = await this.stockCountRepository.products(id, count.category_id);
    return toCountDto(count, products, user.role === 'admin' || count.status === 'closed');
  }

  async countLine(id: number, productId: number, counted: number, user: PublicUser): Promise<StockCountDto> {
    await this.transactions.run(async (repos) => {
      const count = await this.lockCount(repos, id);
      if (count.status !== 'open') throw new ConflictError(`This count was ${count.status}. Start a new one to count again.`);
      if (!(await repos.stockCounts.isInScope(productId, count.category_id))) {
        throw new ValidationError(`That product is not part of the count of ${scopeLabel(count)}`);
      }
      const product = (await repos.products.findById(productId, true))!;
      await repos.stockCounts.upsertLine({
        countId: id,
        productId,
        counted,
        expected: product.quantity_on_hand ?? 0,
        unitCost: toMoneyOrNull(product.cost_price),
        countedBy: user.id,
      });
    });
    return this.get(id, user);
  }

  /** Matching lines go through; the rest wait for the owner. A count with no differences closes at once. */
  async submit(id: number, user: PublicUser): Promise<StockCountDto> {
    await this.transactions.run(async (repos) => {
      const count = await this.lockCount(repos, id);
      if (count.status !== 'open') throw new ConflictError(`This count was already ${count.status}`);
      const counted = await repos.stockCounts.lines(id);
      if (counted.length === 0) throw new ValidationError('Count at least one product before submitting');

      const pending = await repos.stockCounts.markSubmitted(id, user.id);
      await repos.activityLog.create({
        userId: user.id,
        action: 'count.submitted',
        entityType: 'stock_count',
        entityId: id,
        summary: `Submitted the stock count of ${scopeLabel(count)}: ${counted.length} counted, ${pending} different`,
        details: { counted: counted.length, differences: pending },
      });
      if (pending === 0) {
        await repos.stockCounts.setStatus(id, 'closed');
      } else {
        await notifyAdminsOfPending(
          repos,
          'stock count',
          `${user.name} counted ${scopeLabel(count)}: ${pending} ${pending === 1 ? 'product differs' : 'products differ'} from the system.`,
        );
      }
    });
    return this.get(id, user);
  }

  async cancel(id: number, user: PublicUser): Promise<StockCountDto> {
    await this.transactions.run(async (repos) => {
      const count = await this.lockCount(repos, id);
      if (user.role !== 'admin' && count.started_by !== user.id) {
        throw new ForbiddenError('Only the person who started this count, or the owner, can cancel it');
      }
      if (count.status !== 'open') throw new ConflictError(`This count was already ${count.status}`);
      await repos.stockCounts.setStatus(id, 'cancelled');
      await repos.activityLog.create({
        userId: user.id,
        action: 'count.cancelled',
        entityType: 'stock_count',
        entityId: id,
        summary: `Cancelled the stock count of ${scopeLabel(count)}`,
      });
    });
    return this.get(id, user);
  }

  /**
   * Apply the difference found (counted − expected) to today's stock, not the
   * counted number itself, so sales made since the product was counted are kept.
   */
  async approveLine(id: number, productId: number, admin: PublicUser): Promise<StockCountDto> {
    await this.transactions.run(async (repos) => {
      const { count, line } = await this.lockPendingLine(repos, id, productId);
      const difference = line.counted_quantity - line.expected_quantity;
      const product = await repos.products.findById(productId, true);
      try {
        await applyStockChange(repos, {
          productId,
          productName: line.product_name,
          delta: difference,
          reason: SYSTEM_STOCK_REASONS.RECOUNT,
          notes: `Count #${id}`,
          adjustedBy: admin.id,
          reorderLevel: product?.reorder_level ?? 0,
        });
      } catch (error) {
        if (error instanceof ValidationError) {
          throw new ConflictError(`Stock of ${line.product_name} has changed since it was counted. Count it again.`);
        }
        throw error;
      }
      await repos.stockCounts.decideLine(id, productId, { status: 'approved', decidedBy: admin.id, note: null });
      await repos.activityLog.create({
        userId: admin.id,
        action: 'count.line_approved',
        entityType: 'stock_count',
        entityId: id,
        summary: `Corrected ${line.product_name} by ${difference > 0 ? '+' : ''}${difference} after the count of ${scopeLabel(count)}`,
        details: { productId, counted: line.counted_quantity, expected: line.expected_quantity, difference },
      });
      await this.closeIfDone(repos, count, admin.id);
    });
    return this.get(id, admin);
  }

  async rejectLine(id: number, productId: number, admin: PublicUser, note: string): Promise<StockCountDto> {
    await this.transactions.run(async (repos) => {
      const { count, line } = await this.lockPendingLine(repos, id, productId);
      await repos.stockCounts.decideLine(id, productId, { status: 'rejected', decidedBy: admin.id, note });
      await repos.activityLog.create({
        userId: admin.id,
        action: 'count.line_rejected',
        entityType: 'stock_count',
        entityId: id,
        summary: `Kept the stock of ${line.product_name} unchanged after the count of ${scopeLabel(count)}: ${note}`,
      });
      await this.closeIfDone(repos, count, admin.id);
    });
    return this.get(id, admin);
  }

  /** Approve every pending line that can be applied; report the ones that couldn't. */
  async approveAll(id: number, admin: PublicUser) {
    const pending = await this.stockCountRepository.lines(id, 'pending');
    const failed: Array<{ productId: number; productName: string; message: string }> = [];
    let approved = 0;
    for (const line of pending) {
      try {
        await this.approveLine(id, line.product_id, admin);
        approved += 1;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        failed.push({ productId: line.product_id, productName: line.product_name, message: error.message });
      }
    }
    return { approved, failed };
  }

  private async lockCount(repos: TransactionalRepositories, id: number): Promise<StockCountRecord> {
    const count = await repos.stockCounts.lock(id);
    if (!count) throw new NotFoundError(`Stock count ${id} does not exist`);
    return count;
  }

  private async lockPendingLine(repos: TransactionalRepositories, id: number, productId: number) {
    const count = await this.lockCount(repos, id);
    if (count.status !== 'submitted') throw new ConflictError(`This count is ${count.status}, not waiting for approval`);
    const line = await repos.stockCounts.lockLine(id, productId);
    if (!line) throw new NotFoundError('That product was not counted in this count');
    assertPending(line.status ?? 'not submitted', 'count line');
    return { count, line };
  }

  private async closeIfDone(repos: TransactionalRepositories, count: StockCountRecord, adminId: number): Promise<void> {
    const stillPending = await repos.stockCounts.lines(count.id, 'pending');
    if (stillPending.length > 0) return;
    await repos.stockCounts.setStatus(count.id, 'closed');
    await notifyRequester(
      repos,
      count.submitted_by,
      adminId,
      `Your stock count of ${scopeLabel(count)} was reviewed`,
      'The stock has been corrected where the owner approved it.',
    );
  }
}

export function scopeLabel(count: { category_name: string | null }): string {
  return count.category_name ?? 'the whole shop';
}

function toSummaryDto(count: StockCountRecord): StockCountSummaryDto {
  return {
    id: count.id,
    category: count.category_id === null ? null : { id: count.category_id, name: count.category_name ?? 'Unknown' },
    status: count.status,
    startedBy: count.started_by === null ? null : { id: count.started_by, name: count.started_by_name ?? 'Unknown' },
    startedAt: count.started_at.toISOString(),
    submittedAt: toIsoOrNull(count.submitted_at),
    closedAt: toIsoOrNull(count.closed_at),
  };
}

function toCountDto(count: StockCountRecord, products: CountProductRow[], showExpected: boolean): StockCountDto {
  let differences = 0;
  let pending = 0;
  let shortageValue = 0;
  const lines = products.map((row): StockCountLineDto => {
    const line: StockCountLineDto = {
      productId: row.product_id,
      productName: row.product_name,
      sku: row.sku,
      categoryName: row.category_name,
      countedQuantity: row.counted_quantity,
      status: row.status,
      decisionNote: row.decision_note,
    };
    if (row.counted_quantity === null || row.expected_quantity === null) return line;

    const difference = row.counted_quantity - row.expected_quantity;
    const unitCost = toMoneyOrNull(row.unit_cost);
    const value = unitCost === null ? null : roundMoney(difference * unitCost);
    if (difference !== 0) differences += 1;
    if (row.status === 'pending') pending += 1;
    if (value !== null && row.status !== 'rejected') shortageValue -= value;
    return showExpected ? { ...line, expectedQuantity: row.expected_quantity, difference, value } : line;
  });

  return {
    ...toSummaryDto(count),
    totals: {
      products: products.length,
      counted: products.filter((row) => row.counted_quantity !== null).length,
      differences: showExpected ? differences : null,
      pending: showExpected ? pending : null,
      shortageValue: showExpected ? roundMoney(shortageValue) : null,
    },
    lines,
  };
}
