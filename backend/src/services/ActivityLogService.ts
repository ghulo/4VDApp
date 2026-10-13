import type { UserRole } from '../database/types.js';
import { NotFoundError } from '../errors/httpErrors.js';
import type { ActivityFilters, ActivityLogRepository, ActivityRecord } from '../repositories/ActivityLogRepository.js';
import type { UndoRepository } from '../repositories/UndoRepository.js';
import type { DocumentRepository } from '../repositories/DocumentRepository.js';
import type { ActivityEntityType } from '../constants/activity.js';
import { fieldChangesOf } from './activity/fieldChanges.js';
import { isSay, sayIn } from '../i18n/activityText.js';
import type { Language } from '../i18n/language.js';
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

/** Who is looking; sentences are written in their language (English when not known). */
type Viewer = { id: number; role: UserRole; language?: Language };

export interface ActivityQuery extends PageRequest, Omit<ActivityFilters, 'limit' | 'offset'> {}

/** Plenty for one record; a product with years of stock changes shows its newest. */
const HISTORY_LIMIT = 300;

export class ActivityLogService {
  constructor(
    private readonly activityLogRepository: ActivityLogRepository,
    private readonly undoRepository: UndoRepository,
    private readonly documentRepository: DocumentRepository,
  ) {}

  /**
   * One record's whole history, oldest first: its own entries and the undos of
   * them. An invoice also takes in its sales, their returns and its credit notes,
   * so a sale's changes show where the sale is looked at.
   */
  async history(entityType: ActivityEntityType, entityId: number, viewer: Viewer) {
    const records: Array<{ entityType: string; ids: number[] }> = [{ entityType, ids: [entityId] }];
    if (entityType === 'document') {
      const related = await this.documentRepository.related(entityId);
      records[0] = { entityType: 'document', ids: related.documentIds };
      records.push({ entityType: 'sale', ids: related.saleIds }, { entityType: 'return', ids: related.returnIds });
    }
    return this.toDtos(await this.activityLogRepository.findHistory(records, HISTORY_LIMIT), viewer);
  }

  /** A page of entries, each with its undo state as `viewer` sees it. */
  async list(query: ActivityQuery, viewer: Viewer) {
    const { entries, total } = await this.activityLogRepository.findMany({
      userId: query.userId,
      entityType: query.entityType,
      entityId: query.entityId,
      actions: query.actions,
      excludeActions: query.excludeActions,
      search: query.search,
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
      summary: isSay(entry.summary_say) ? sayIn(entry.summary_say, viewer.language ?? 'en') : entry.summary,
      details: entry.details,
      /** The fields it changed, before and after, the same shape whichever way it was logged. */
      changes: fieldChangesOf(entry),
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
