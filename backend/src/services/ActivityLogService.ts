import type { ActivityFilters, ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
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

export interface ActivityQuery extends PageRequest, Omit<ActivityFilters, 'limit' | 'offset'> {}

export class ActivityLogService {
  constructor(private readonly activityLogRepository: ActivityLogRepository) {}

  async list(query: ActivityQuery) {
    const { entries, total } = await this.activityLogRepository.findMany({
      userId: query.userId,
      entityType: query.entityType,
      entityId: query.entityId,
      actions: query.actions,
      limit: query.limit,
      offset: toOffset(query),
    });
    return {
      items: entries.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entity_type,
        entityId: entry.entity_id,
        summary: entry.summary,
        details: entry.details,
        createdAt: entry.created_at.toISOString(),
        user: entry.user_id === null ? null : { id: entry.user_id, name: entry.user_name ?? 'Removed user' },
      })),
      meta: toPaginationMeta(query, total),
    };
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
