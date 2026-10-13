import type { ActivityAction, ActivityEntityType } from '../constants/activity.js';
import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import { type Say, sayIn } from '../i18n/activityText.js';

export interface NewActivity {
  userId: number | null;
  action: ActivityAction;
  entityType: ActivityEntityType | null;
  entityId: number | null;
  /** What happened, as a sentence key and its values; written out in each reader's language. */
  say: Say;
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
  /** Words that must all appear in the summary (or its names and values), any case. */
  search?: string;
  limit: number;
  offset: number;
}

export interface ActivityRecord {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  summary: string;
  summary_say: Record<string, unknown> | null;
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
        summary: sayIn(entry.say, 'en'),
        summary_say: entry.say,
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
    for (const word of filters.search?.trim().split(/\s+/).filter(Boolean) ?? []) {
      const pattern = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      // The English sentence, or the names and values inside it whatever language is searched in.
      query = query.where((eb) => eb.or([eb('a.summary', 'ilike', pattern), eb(sql<string>`a.summary_say::text`, 'ilike', pattern)]));
    }

    const [entries, count] = await Promise.all([
      query
        .select([
          'a.id',
          'a.action',
          'a.entity_type',
          'a.entity_id',
          'a.summary',
          'a.summary_say',
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

  /**
   * Everything that happened to some records, oldest first: entries about any
   * of them, plus the undos and restores of those entries.
   */
  /**
   * Every entry about one record after `afterId`, oldest first: undone ones
   * and undos' own changes included, since each really changed a value.
   */
  findAfter(entityType: string, entityId: number, afterId: number) {
    return this.db
      .selectFrom('activity_log')
      .select(['id', 'action', 'details'])
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', entityId)
      .where('id', '>', afterId)
      .orderBy('id', 'asc')
      .execute();
  }

  async findHistory(records: Array<{ entityType: string; ids: number[] }>, limit: number): Promise<ActivityRecord[]> {
    const wanted = records.filter((record) => record.ids.length > 0);
    if (wanted.length === 0) return [];
    const select = [
      'a.id',
      'a.action',
      'a.entity_type',
      'a.entity_id',
      'a.summary',
      'a.summary_say',
      'a.details',
      'a.created_at',
      'a.user_id',
      'u.name as user_name',
      'a.undone_at',
      'a.undone_by',
      'a.undo_note',
    ] as const;
    const base = () => this.db.selectFrom('activity_log as a').leftJoin('users as u', 'u.id', 'a.user_id').select(select);
    const entries = await base()
      .where((eb) => eb.or(wanted.map((record) => eb.and([eb('a.entity_type', '=', record.entityType), eb('a.entity_id', 'in', record.ids)]))))
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id', 'desc')
      .limit(limit)
      .execute();
    if (entries.length === 0) return [];
    const undos = await base()
      .where('a.entity_type', '=', 'activity')
      .where('a.entity_id', 'in', entries.map((entry) => entry.id))
      .execute();
    return [...entries, ...undos].sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id - b.id);
  }
}
