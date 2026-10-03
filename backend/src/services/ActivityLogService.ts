import type { UserRole } from '../database/types.js';
import { NotFoundError } from '../errors/httpErrors.js';
import type { ActivityFilters, ActivityLogRepository, ActivityRecord } from '../repositories/ActivityLogRepository.js';
import type { UndoRepository } from '../repositories/UndoRepository.js';
import { undoStatesFor } from './undo/undoStates.js';
import { type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';

/** Enough for any one product's price changes; the app has a handful a year. */
const PRICE_HISTORY_LIMIT = 200;

export interface PriceChangeDto {
  changedAt: string;
  changedBy: string | null;
  /** Null when this entry did not change it. `from` is null for a new product. */
  price: { from: number | null; to: number } | null;
  costPrice: { from: number | null; to: number | null } | null;
}

interface FieldChange {
  from: unknown;
  to: unknown;
}

type Viewer = { id: number; role: UserRole };

export interface ActivityQuery extends PageRequest, Omit<ActivityFilters, 'limit' | 'offset'> {}

export class ActivityLogService {
  constructor(
    private readonly activityLogRepository: ActivityLogRepository,
    private readonly undoRepository: UndoRepository,
  ) {}

  /** A page of entries, each with its undo state as `viewer` sees it. */
  async list(query: ActivityQuery, viewer: Viewer) {
    const { entries, total } = await this.activityLogRepository.findMany({
      userId: query.userId,
      entityType: query.entityType,
      entityId: query.entityId,
      actions: query.actions,
      excludeActions: query.excludeActions,
      limit: query.limit,
      offset: toOffset(query),
    });
    return { items: await this.toDtos(entries, viewer), meta: toPaginationMeta(query, total) };
  }

  async get(id: number, viewer: Viewer) {
    const { entries } = await this.activityLogRepository.findMany({ id, limit: 1, offset: 0 });
    if (entries.length === 0) throw new NotFoundError(`Activity entry ${id} does not exist`);
    return (await this.toDtos(entries, viewer))[0]!;
  }

  private async toDtos(entries: ActivityRecord[], viewer: Viewer) {
    const undo = await undoStatesFor(this.undoRepository, entries, viewer);
    return entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entity_type,
      entityId: entry.entity_id,
      summary: entry.summary,
      details: entry.details,
      createdAt: entry.created_at.toISOString(),
      user: entry.user_id === null ? null : { id: entry.user_id, name: entry.user_name ?? 'Removed user' },
      undo: undo.get(entry.id) ?? null,
    }));
  }

  /** Every change to a product's price or cost, newest first, read from the activity log. */
  async priceHistory(productId: number): Promise<PriceChangeDto[]> {
    const { entries } = await this.activityLogRepository.findMany({
      entityType: 'product',
      entityId: productId,
      actions: ['product.created', 'product.updated'],
      limit: PRICE_HISTORY_LIMIT,
      offset: 0,
    });
    return entries.flatMap((entry) => {
      const details = entry.details ?? {};
      let price: PriceChangeDto['price'] = null;
      let costPrice: PriceChangeDto['costPrice'] = null;
      if (entry.action === 'product.created') {
        if (typeof details.price === 'number') price = { from: null, to: details.price };
        if (typeof details.costPrice === 'number') costPrice = { from: null, to: details.costPrice };
      } else {
        const priceChange = details.price as FieldChange | undefined;
        const costChange = details.costPrice as FieldChange | undefined;
        if (priceChange) price = { from: priceChange.from as number, to: priceChange.to as number };
        if (costChange) costPrice = { from: costChange.from as number | null, to: costChange.to as number | null };
      }
      if (!price && !costPrice) return [];
      return [{ changedAt: entry.created_at.toISOString(), changedBy: entry.user_name, price, costPrice }];
    });
  }
}
