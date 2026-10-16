import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { DuplicatePairRecord, DuplicateRepository, DuplicateSideRecord } from '../repositories/DuplicateRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';

export interface DuplicateSideDto {
  id: number;
  name: string;
  barcode: string | null;
  sku: string | null;
  price: number;
  costPrice: number | null;
  imageUrl: string | null;
  category: string;
  stock: number;
  unitsSold90d: number;
  unitsSold: number;
  lastSoldAt: string | null;
}

export interface DuplicatePairDto {
  id: number;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: 'merged' | 'kept_both' | null;
  resolvedBy: string | null;
  /** Both sides, the busier seller first, so the likely keeper is on the left. */
  products: [DuplicateSideDto, DuplicateSideDto];
}

export interface MergeInput {
  /** The product that stays; the other is folded into it. */
  keepId: number;
  /** The product whose barcode the kept one ends up with. */
  barcodeFromId: number;
}

function toSide(side: DuplicateSideRecord): DuplicateSideDto {
  return {
    id: side.id,
    name: side.name,
    barcode: side.barcode,
    sku: side.sku,
    price: Number(side.base_price),
    costPrice: side.cost_price === null ? null : Number(side.cost_price),
    imageUrl: side.image_url,
    category: side.category_name,
    stock: side.quantity_on_hand,
    unitsSold90d: Number(side.units_sold_90d),
    unitsSold: Number(side.units_sold),
    lastSoldAt: side.last_sold_at ? new Date(side.last_sold_at).toISOString() : null,
  };
}

function toPair(row: DuplicatePairRecord): DuplicatePairDto {
  const a = toSide(row.product);
  const b = toSide(row.other);
  const busierFirst = b.unitsSold90d > a.unitsSold90d || (b.unitsSold90d === a.unitsSold90d && b.unitsSold > a.unitsSold);
  return {
    id: row.id,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    resolution: row.resolution,
    resolvedBy: row.resolved_by_name,
    products: busierFirst ? [b, a] : [a, b],
  };
}

/**
 * Products that look like the same item twice (flagged by the TREFIN import):
 * someone merges each pair into one product, or keeps both. A merge moves the
 * other product's sales, stock and history onto the kept one, so stock and
 * reports add up in one place.
 */
export class DuplicateService {
  constructor(
    private readonly duplicates: DuplicateRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async list(status: 'open' | 'done'): Promise<DuplicatePairDto[]> {
    return (await this.duplicates.list(status)).map(toPair);
  }

  countOpen(): Promise<number> {
    return this.duplicates.countOpen();
  }

  async merge(id: number, input: MergeInput, actorId: number): Promise<void> {
    await this.transactions.run(async (repos) => {
      const flag = await this.openFlag(repos.duplicates, id);
      const pair = [flag.product_id, flag.other_product_id];
      if (!pair.includes(input.keepId) || !pair.includes(input.barcodeFromId)) {
        throw new ValidationError('keepId and barcodeFromId must be one of the two products in the pair');
      }
      const dropId = pair.find((productId) => productId !== input.keepId)!;
      const products = await repos.duplicates.lockProducts(pair);
      const keep = products.find((product) => product.id === input.keepId);
      const drop = products.find((product) => product.id === dropId);
      if (!keep || !drop || keep.deleted_at || drop.deleted_at) {
        throw new ConflictError('One of these products has been deleted, so they can no longer be merged.');
      }
      const barcode = (input.barcodeFromId === keep.id ? keep.barcode : drop.barcode) ?? keep.barcode ?? drop.barcode;
      const dropStock = drop.quantity_on_hand ?? 0;

      await repos.duplicates.merge({
        keepId: keep.id,
        dropId,
        barcode,
        dropStock,
        reorderLevel: Math.max(keep.reorder_level ?? 0, drop.reorder_level ?? 0),
      });
      if (dropStock > 0) {
        await repos.stockAdjustments.create({
          productId: keep.id,
          quantity: dropStock,
          reason: SYSTEM_STOCK_REASONS.MERGE,
          notes: drop.name,
          adjustedBy: actorId,
        });
      }
      await repos.duplicates.resolve(id, 'merged', actorId);
      await repos.duplicates.repoint(dropId, keep.id);
      await repos.activityLog.create({
        userId: actorId,
        action: 'product.merged',
        entityType: 'product',
        entityId: keep.id,
        say: { key: 'productsMerged', params: { kept: keep.name, merged: drop.name } },
        details: {
          mergedProductId: dropId,
          stockAdded: dropStock,
          ...(barcode !== keep.barcode && { barcode: { from: keep.barcode, to: barcode } }),
        },
      });
    });
  }

  async keepBoth(id: number, actorId: number): Promise<void> {
    await this.transactions.run(async (repos) => {
      const flag = await this.openFlag(repos.duplicates, id);
      const products = await repos.duplicates.lockProducts([flag.product_id, flag.other_product_id]);
      const [a, b] = [flag.product_id, flag.other_product_id].map((productId) => products.find((product) => product.id === productId)?.name ?? '');
      await repos.duplicates.resolve(id, 'kept_both', actorId);
      await repos.activityLog.create({
        userId: actorId,
        action: 'product.kept_apart',
        entityType: 'product',
        entityId: flag.product_id,
        say: { key: 'duplicateKeptApart', params: { name: a!, other: b! } },
        details: { otherProductId: flag.other_product_id },
      });
    });
  }

  private async openFlag(duplicates: DuplicateRepository, id: number) {
    const flag = await duplicates.findForUpdate(id);
    if (!flag) throw new NotFoundError(`Duplicate pair ${id} does not exist`);
    if (flag.resolved_at) throw new ConflictError('Someone has already dealt with this pair.');
    return flag;
  }
}
