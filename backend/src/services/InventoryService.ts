import { RECENT_ADJUSTMENTS_LIMIT } from '../constants/stock.js';
import { allowsParts } from '../constants/units.js';
import { NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { InventoryRecord, InventoryRepository } from '../repositories/InventoryRepository.js';
import type { StockAdjustmentRepository } from '../repositories/StockAdjustmentRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { type Paginated, type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import { getStockAlert, isLowStock } from './inventory/stockAlerts.js';
import { toIsoOrNull } from './mappers.js';
import { rolesWith } from '../utils/roles.js';

export interface InventoryItemDto {
  productId: number;
  productName: string;
  sku: string | null;
  imageUrl: string | null;
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
    /** Where it happened; null on changes from before locations. */
    location: string | null;
  }>;
  /** Its lines in TREFIN's starting stocks, corrections and counts: history, they moved nothing here. */
  trefinHistory: Array<{
    id: number;
    documentId: number;
    kind: 'opening' | 'correction' | 'count';
    number: string | null;
    /** "YYYY-MM-DD". */
    dated: string;
    source: string;
    quantity: number;
    counted: number | null;
    unitCost: number | null;
  }>;
}

export interface StockAdjustmentInput {
  /** Positive adds stock, negative removes it. */
  quantity?: number;
  reason?: string;
  notes: string | null;
  reorderLevel?: number;
  /** Where; null or left out is where the till sells from. */
  locationId?: number | null;
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

    const [adjustments, trefin] = await Promise.all([
      this.stockAdjustmentRepository.findRecentForProduct(productId, RECENT_ADJUSTMENTS_LIMIT),
      this.stockAdjustmentRepository.trefinForProduct(productId),
    ]);
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
        location: adjustment.location_name,
      })),
      trefinHistory: trefin.map((line) => ({
        id: line.id,
        documentId: line.document_id,
        kind: line.kind,
        number: line.number,
        dated: line.dated,
        source: line.source,
        quantity: Number(line.quantity),
        counted: line.counted === null ? null : Number(line.counted),
        unitCost: line.unit_cost === null ? null : Number(line.unit_cost),
      })),
    };
  }

  /**
   * Change stock by hand. The stock update, the audit-trail entry and any
   * low-stock notification are saved together or not at all.
   */
  async adjust(
    productId: number,
    input: StockAdjustmentInput,
    adjustedBy: number,
    logExtra?: Record<string, unknown>,
  ): Promise<InventoryDetailDto> {
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
          say: { key: 'reorderLevelChanged', params: { product: item.product_name, from: item.reorder_level, to: input.reorderLevel } },
          details: { reorderLevel: { from: item.reorder_level, to: input.reorderLevel }, ...logExtra },
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
          locationId: input.locationId ?? null,
        });
        const amount = Math.abs(input.quantity);
        await repos.activityLog.create({
          userId: adjustedBy,
          action: 'stock.adjusted',
          entityType: 'product',
          entityId: productId,
          say: { key: input.quantity > 0 ? 'stockAdded' : 'stockRemoved', params: { product: item.product_name, amount, reason } },
          details: { quantity: input.quantity, reason, notes: input.notes, before, after, locationId: input.locationId ?? null },
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
    /**
     * Where it comes in or goes out; null is where the till sells from. What
     * goes out is taken from here first and the rest from the other locations
     * (the shelf had it after all), each part noted "from <location>". Only
     * the total can run short.
     */
    locationId: number | null;
  },
): Promise<{ before: number; after: number }> {
  // Part of a piece is never sold, counted or written off; kilos go to the gram.
  if (!Number.isInteger(change.delta) && !allowsParts(await repos.products.unitOf(change.productId))) {
    throw new ValidationError(`${change.productName} is sold by the piece: use a whole number, not ${change.delta}`);
  }
  const locationId = change.locationId ?? (await repos.locations.sellingId());
  const notEnough = () => new ValidationError(`Not enough stock of ${change.productName} to remove ${Math.abs(change.delta)}`);

  // What each location gives (negative) or gets.
  const parts: Array<{ locationId: number; delta: number }> = [];
  if (change.delta >= 0) {
    parts.push({ locationId, delta: change.delta });
  } else {
    const held = await repos.inventory.byLocationForUpdate(change.productId);
    const order = [...held.filter((row) => row.location_id === locationId), ...held.filter((row) => row.location_id !== locationId).sort((a, b) => b.quantity - a.quantity)];
    let need = -change.delta;
    for (const row of order) {
      if (need <= 0) break;
      const take = roundQuantity(Math.min(row.quantity, need));
      if (take <= 0) continue;
      parts.push({ locationId: row.location_id, delta: -take });
      need = roundQuantity(need - take);
    }
    if (need > 0) throw notEnough();
  }

  const names = parts.some((part) => part.locationId !== locationId) ? await repos.locations.names() : null;
  let result: { before: number; after: number } | undefined;
  for (const part of parts) {
    const moved = await repos.inventory.applyDelta(change.productId, part.locationId, part.delta);
    if (!moved) throw notEnough();
    result = { before: result?.before ?? moved.before, after: moved.after };
    const from = part.locationId === locationId ? null : `from ${names!.get(part.locationId)}`;
    await repos.stockAdjustments.create({
      productId: change.productId,
      quantity: part.delta,
      reason: change.reason,
      notes: from ? (change.notes ? `${change.notes} (${from})` : from) : change.notes,
      adjustedBy: change.adjustedBy,
      locationId: part.locationId,
    });
  }
  if (!result) throw notEnough();

  const alert = getStockAlert({
    productName: change.productName,
    before: result.before,
    after: result.after,
    reorderLevel: change.reorderLevel,
  });
  if (alert) await repos.notifications.createForRoles(rolesWith('oversee'), alert);
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
    imageUrl: item.image_url,
    quantity: item.quantity_on_hand,
    reorderLevel: item.reorder_level,
    isLowStock: isLowStock(item.quantity_on_hand, item.reorder_level),
    lastRestockedAt: toIsoOrNull(item.last_restocked_at),
    updatedAt: item.updated_at.toISOString(),
  };
}

/** Quantities go to the gram, so sums never drift. */
const roundQuantity = (value: number) => Math.round(value * 1000) / 1000;
