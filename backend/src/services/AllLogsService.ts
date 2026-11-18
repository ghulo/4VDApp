import { isSay, sayIn } from '../i18n/activityText.js';
import type { Language } from '../i18n/language.js';
import type { AllLogsRepository } from '../repositories/AllLogsRepository.js';
import { type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import { fieldChangesOf } from './activity/fieldChanges.js';

/** The signed-in 4VD developer, as requireAuth read them from the database. Never built from request input. */
export interface AllLogsViewer {
  id: number;
  language?: Language;
}

export interface AllActivityQuery extends PageRequest {
  businessId?: number;
  actions?: string[];
  excludeActions?: string[];
  search?: string;
}

/** All logs (developer only): every business's history and the support visits, read across businesses. */
export class AllLogsService {
  constructor(private readonly allLogsRepository: AllLogsRepository) {}

  async activity(viewer: AllLogsViewer, query: AllActivityQuery) {
    const { rows, total } = await this.allLogsRepository.activity(viewer.id, {
      businessId: query.businessId,
      actions: query.actions,
      excludeActions: query.excludeActions,
      search: query.search,
      limit: query.limit,
      offset: toOffset(query),
    });
    const items = rows.map((row) => ({
      id: row.id,
      business: { id: row.business_id, name: row.business_name },
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      summary: isSay(row.summary_say) ? sayIn(row.summary_say, viewer.language ?? 'en') : row.summary,
      details: row.details,
      changes: fieldChangesOf(row),
      createdAt: row.created_at.toISOString(),
      user: row.user_id === null ? null : { id: row.user_id, name: row.user_name ?? 'Removed user', isDeveloper: row.user_is_developer },
      undoneAt: row.undone_at?.toISOString() ?? null,
    }));
    return { items, meta: toPaginationMeta(query, total) };
  }

  async support(viewer: AllLogsViewer, query: PageRequest & { businessId?: number }) {
    const { rows, total } = await this.allLogsRepository.support(viewer.id, { businessId: query.businessId, limit: query.limit, offset: toOffset(query) });
    const items = rows.map((row) => ({
      id: row.id,
      business: { id: row.business_id, name: row.business_name },
      developer: { id: row.developer_id, name: row.developer_name },
      reason: row.reason,
      startedAt: row.started_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      actions: row.actions,
    }));
    return { items, meta: toPaginationMeta(query, total) };
  }

  businesses() {
    return this.allLogsRepository.businesses();
  }
}
