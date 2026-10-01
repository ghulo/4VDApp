import { RECENT_ADJUSTMENTS_LIMIT } from '../constants/stock.js';
import { NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { InventoryRecord, InventoryRepository } from '../repositories/InventoryRepository.js';
import type { StockAdjustmentRepository } from '../repositories/StockAdjustmentRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { type Paginated, type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import { getStockAlert, isLowStock } from './inventory/stockAlerts.js';
import { toIsoOrNull } from './mappers.js';

export interface InventoryItemDto {
  productId: number;
  productName: string;
  sku: string | null;
  quantity: number;
  reorderLevel: number;
  isLowStock: boolean;
  lastRestockedAt: string | null;
  updatedAt: string;
}

export interface InventoryDetailDto extends InventoryItemDto {
  warnings: string[];
  recentAdjustments: Array<{
    id: number;
    quantity: number;
    reason: string;
    notes: string | null;
    adjustedBy: string | null;
    date: string;
  }>;
}

export interface StockAdjustmentInput {
  /** Positive adds stock, negative removes it. */
  quantity?: number;
  reason?: string;
  notes: string | null;
  reorderLevel?: number;
}

export interface InventoryQuery extends PageRequest {
  lowStockOnly: boolean;
  search?: string;
}

export class InventoryService {
  constructor(
    private readonly inventoryRepository: InventoryRepository,
    private readonly stockAdjustmentRepository: StockAdjustmentRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async list(query: InventoryQuery): Promise<Paginated<InventoryItemDto>> {
    const { items, total } = await this.inventoryRepository.findMany({
      lowStockOnly: query.lowStockOnly,
      search: query.search,
      limit: query.limit,
      offset: toOffset(query),
    });
    return { items: items.map(toInventoryItemDto), meta: toPaginationMeta(query, total) };
  }

  async getByProductId(productId: number): Promise<InventoryDetailDto> {
    const item = await this.inventoryRepository.findByProductId(productId);
    if (!item) throw new NotFoundError(`No stock record for product ${productId}`);

    const adjustments = await this.stockAdjustmentRepository.findRecentForProduct(productId, RECENT_ADJUSTMENTS_LIMIT);
    return {
      ...toInventoryItemDto(item),
      warnings: buildWarnings(item.quantity_on_hand, item.reorder_level),
      recentAdjustments: adjustments.map((adjustment) => ({
        id: adjustment.id,
        quantity: adjustment.adjustment_quantity,
        reason: adjustment.reason,
        notes: adjustment.notes,
        adjustedBy: adjustment.adjusted_by_name,
        date: adjustment.adjustment_date.toISOString(),
      })),
    };
  }

  /**
   * Change stock by hand. The stock update, the audit-trail entry and any
   * low-stock notification are saved together or not at all.
   */
  async adjust(productId: number, input: StockAdjustmentInput, adjustedBy: number): Promise<InventoryDetailDto> {
    const item = await this.inventoryRepository.findByProductId(productId);
    if (!item) throw new NotFoundError(`No stock record for product ${productId}`);

    await this.transactions.run(async (repos) => {
      if (input.reorderLevel !== undefined && input.reorderLevel !== item.reorder_level) {
        await repos.inventory.setReorderLevel(productId, input.reorderLevel);
        await repos.activityLog.create({
          userId: adjustedBy,
          action: 'stock.adjusted',
          entityType: 'product',
          entityId: productId,
          summary: `Changed reorder level of ${item.product_name} from ${item.reorder_level} to ${input.reorderLevel}`,
          details: { reorderLevel: { from: item.reorder_level, to: input.reorderLevel } },
        });
      }
      if (input.quantity !== undefined) {
        const reason = input.reason ?? 'Manual adjustment';
        const { before, after } = await applyStockChange(repos, {
          productId,
          productName: item.product_name,
          delta: input.quantity,
          reason,
          notes: input.notes,
          adjustedBy,
          reorderLevel: input.reorderLevel ?? item.reorder_level,
        });
        const amount = Math.abs(input.quantity);
        await repos.activityLog.create({
          userId: adjustedBy,
          action: 'stock.adjusted',
          entityType: 'product',
          entityId: productId,
          summary:
            input.quantity > 0
              ? `Added ${amount} to ${item.product_name} (${reason})`
              : `Removed ${amount} from ${item.product_name} (${reason})`,
          details: { quantity: input.quantity, reason, notes: input.notes, before, after },
        });
      }
    });

    return this.getByProductId(productId);
  }
}

/**
 * Shared by manual adjustments and sales: move stock, log it, and notify
 * admins if this change pushed the product into low or zero stock.
 * Must be called inside a transaction.
 */
export async function applyStockChange(
  repos: TransactionalRepositories,
  change: {
    productId: number;
    productName: string;
    delta: number;
    reason: string;
    notes: string | null;
    adjustedBy: number;
    reorderLevel: number;
  },
): Promise<{ before: number; after: number }> {
  const result = await repos.inventory.applyDelta(change.productId, change.delta);
  if (!result) {
    throw new ValidationError(`Not enough stock of ${change.productName} to remove ${Math.abs(change.delta)}`);
  }

  await repos.stockAdjustments.create({
    productId: change.productId,
    quantity: change.delta,
    reason: change.reason,
    notes: change.notes,
    adjustedBy: change.adjustedBy,
  });

  const alert = getStockAlert({
    productName: change.productName,
    before: result.before,
    after: result.after,
    reorderLevel: change.reorderLevel,
  });
  if (alert) await repos.notifications.createForRoles(['admin'], alert);
  return result;
}

function buildWarnings(quantity: number, reorderLevel: number): string[] {
  if (quantity === 0) return ['Out of stock'];
  if (isLowStock(quantity, reorderLevel)) return [`Stock is at or below the reorder level (${reorderLevel})`];
  return [];
}

function toInventoryItemDto(item: InventoryRecord): InventoryItemDto {
  return {
    productId: item.product_id,
    productName: item.product_name,
    sku: item.sku,
    quantity: item.quantity_on_hand,
    reorderLevel: item.reorder_level,
    isLowStock: isLowStock(item.quantity_on_hand, item.reorder_level),
    lastRestockedAt: toIsoOrNull(item.last_restocked_at),
    updatedAt: item.updated_at.toISOString(),
  };
}
