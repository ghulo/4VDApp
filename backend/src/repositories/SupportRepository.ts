import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export interface SupportActionRow {
  at: Date;
  method: string;
  path: string;
  entity: string | null;
  entityId: string | null;
  status: number | null;
}

export interface SupportVisitRow {
  id: number;
  developerName: string;
  startedAt: Date;
  lastSeenAt: Date;
  reason: string | null;
  actions: SupportActionRow[];
}

/**
 * The 4VD developer's visits to a business he isn't a member of, and the
 * changes he made there. Rows live in the visited business (row security),
 * so its people see them and nobody else does.
 */
export class SupportRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Start the visit for this sign-in session, or mark it still going (at most once a minute). Returns its id. */
  async visit(developer: { id: number; name: string }, sessionId: string): Promise<number> {
    const row = await this.db
      .insertInto('support_visits')
      .values({ developer_id: developer.id, developer_name: developer.name, session_id: sessionId })
      .onConflict((oc) =>
        oc
          .columns(['business_id', 'developer_id', 'session_id'])
          .doUpdateSet({ last_seen_at: sql`now()` })
          .where('support_visits.last_seen_at', '<', sql<Date>`now() - interval '1 minute'`),
      )
      .returning('id')
      .executeTakeFirst();
    if (row) return row.id;
    const existing = await this.db
      .selectFrom('support_visits')
      .select('id')
      .where('developer_id', '=', developer.id)
      .where('session_id', '=', sessionId)
      .executeTakeFirstOrThrow();
    return existing.id;
  }

  async action(visitId: number, action: { method: string; path: string; entity: string | null; entityId: string | null }): Promise<number> {
    const row = await this.db
      .insertInto('support_actions')
      .values({ visit_id: visitId, method: action.method, path: action.path, entity: action.entity, entity_id: action.entityId })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** The answer's status, once (the log can't be changed after). */
  async answered(actionId: number, status: number): Promise<void> {
    await this.db.updateTable('support_actions').set({ status }).where('id', '=', actionId).where('status', 'is', null).execute();
  }

  /** The business's visits, newest first, each with its changes in order. */
  async list(limit = 100): Promise<SupportVisitRow[]> {
    const visits = await this.db
      .selectFrom('support_visits')
      .select(['id', 'developer_name', 'started_at', 'last_seen_at', 'reason'])
      .orderBy('started_at', 'desc')
      .limit(limit)
      .execute();
    if (visits.length === 0) return [];
    const actions = await this.db
      .selectFrom('support_actions')
      .select(['visit_id', 'at', 'method', 'path', 'entity', 'entity_id', 'status'])
      .where(
        'visit_id',
        'in',
        visits.map((visit) => visit.id),
      )
      .orderBy('at')
      .execute();
    return visits.map((visit) => ({
      id: visit.id,
      developerName: visit.developer_name,
      startedAt: visit.started_at,
      lastSeenAt: visit.last_seen_at,
      reason: visit.reason,
      actions: actions
        .filter((action) => action.visit_id === visit.id)
        .map((action) => ({ at: action.at, method: action.method, path: action.path, entity: action.entity, entityId: action.entity_id, status: action.status })),
    }));
  }
}
