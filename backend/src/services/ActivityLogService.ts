import type { ActivityFilters, ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import { type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';

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
}
