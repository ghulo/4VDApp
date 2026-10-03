import type { ActivityAction, ActivityEntityType } from '../constants/activity.js';
import type { DatabaseClient } from '../database/connection.js';

export interface NewActivity {
  userId: number | null;
  action: ActivityAction;
  entityType: ActivityEntityType | null;
  entityId: number | null;
  /** A sentence a person can read, e.g. "Changed price of Oak Chair from €89.00 to €95.00". */
  summary: string;
  details?: Record<string, unknown> | null;
}

export interface ActivityFilters {
  /** One entry by its id. */
  id?: number;
  userId?: number;
  entityType?: ActivityEntityType;
  entityId?: number;
  /** Each item is an exact action ("stock.adjusted") or a prefix ("stock"). */
  actions?: string[];
  /** Same format as `actions`, left out of the results. */
  excludeActions?: string[];
  limit: number;
  offset: number;
}

export interface ActivityRecord {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  summary: string;
  details: Record<string, unknown> | null;
  created_at: Date;
  user_id: number | null;
  user_name: string | null;
  /** Set when this entry itself was undone (stock changes and edits). */
  undone_at: Date | null;
  undone_by: number | null;
  undo_note: string | null;
}

export class ActivityLogRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(entry: NewActivity): Promise<void> {
    await this.db
      .insertInto('activity_log')
      .values({
        user_id: entry.userId,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        summary: entry.summary,
        details: entry.details ?? null,
      })
      .execute();
  }

  async findMany(filters: ActivityFilters): Promise<{ entries: ActivityRecord[]; total: number }> {
    let query = this.db.selectFrom('activity_log as a').leftJoin('users as u', 'u.id', 'a.user_id');
    if (filters.id) query = query.where('a.id', '=', filters.id);
    if (filters.userId) query = query.where('a.user_id', '=', filters.userId);
    if (filters.entityType) query = query.where('a.entity_type', '=', filters.entityType);
    if (filters.entityId) query = query.where('a.entity_id', '=', filters.entityId);
    if (filters.actions && filters.actions.length > 0) {
      const actions = filters.actions;
      query = query.where((eb) =>
        eb.or(actions.map((action) => (action.includes('.') ? eb('a.action', '=', action) : eb('a.action', 'like', `${action}.%`)))),
      );
    }
    for (const action of filters.excludeActions ?? []) {
      query = action.includes('.') ? query.where('a.action', '!=', action) : query.where('a.action', 'not like', `${action}.%`);
    }

    const [entries, count] = await Promise.all([
      query
        .select([
          'a.id',
          'a.action',
          'a.entity_type',
          'a.entity_id',
          'a.summary',
          'a.details',
          'a.created_at',
          'a.user_id',
          'u.name as user_name',
          'a.undone_at',
          'a.undone_by',
          'a.undo_note',
        ])
        .orderBy('a.created_at', 'desc')
        .orderBy('a.id', 'desc')
        .limit(filters.limit)
        .offset(filters.offset)
        .execute(),
      query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
    ]);
    return { entries, total: Number(count.total) };
  }
}
