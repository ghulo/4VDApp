import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

/**
 * All logs: every business's activity and the 4VD developer's support visits,
 * read through the database functions all_activity and all_support (migration
 * 088). They check in the database that `developerId` is the 4VD developer and
 * log the read; row security still limits every other query to one business.
 * `developerId` must be the signed-in user (requireAuth), never a value from the request.
 */

export interface AllActivityFilters {
  businessId?: number;
  /** Exact actions ("stock.adjusted") or prefixes ("stock"). */
  actions?: string[];
  excludeActions?: string[];
  search?: string;
  limit: number;
  offset: number;
}

export interface AllActivityRow {
  id: number;
  business_id: number;
  business_name: string;
  user_id: number | null;
  user_name: string | null;
  user_is_developer: boolean;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  summary: string;
  summary_say: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  created_at: Date;
  undone_at: Date | null;
  total: string;
}

export interface SupportVisitAction {
  id: number;
  at: string;
  method: string;
  path: string;
  entity: string | null;
  entityId: string | null;
  status: number | null;
}

export interface AllSupportRow {
  id: number;
  business_id: number;
  business_name: string;
  developer_id: number;
  developer_name: string;
  reason: string | null;
  started_at: Date;
  last_seen_at: Date;
  actions: SupportVisitAction[];
  total: string;
}

const textArray = (items: string[] | undefined) => (items && items.length > 0 ? sql`${items}::text[]` : sql`null::text[]`);
/** Words as ILIKE fragments, with %, _ and \ taken literally. */
const words = (search: string | undefined) => (search?.trim().split(/\s+/).filter(Boolean) ?? []).map((word) => word.replace(/[\\%_]/g, (c) => `\\${c}`));

export class AllLogsRepository {
  constructor(private readonly db: DatabaseClient) {}

  async activity(developerId: number, filters: AllActivityFilters): Promise<{ rows: AllActivityRow[]; total: number }> {
    const { rows } = await sql<AllActivityRow>`
      select * from all_activity(
        ${developerId}::int, ${filters.businessId ?? null}::int, ${textArray(filters.actions)}, ${textArray(filters.excludeActions)},
        ${textArray(words(filters.search))}, ${filters.limit}::int, ${filters.offset}::int)
    `.execute(this.db);
    return { rows, total: rows[0] ? Number(rows[0].total) : 0 };
  }

  async support(developerId: number, filters: { businessId?: number; limit: number; offset: number }): Promise<{ rows: AllSupportRow[]; total: number }> {
    const { rows } = await sql<AllSupportRow>`
      select * from all_support(${developerId}::int, ${filters.businessId ?? null}::int, ${filters.limit}::int, ${filters.offset}::int)
    `.execute(this.db);
    return { rows, total: rows[0] ? Number(rows[0].total) : 0 };
  }

  /** Every business, for the filter chips (businesses has no row security: the picker lists them all for the developer too). */
  async businesses(): Promise<{ id: number; name: string; shortName: string | null }[]> {
    const rows = await this.db.selectFrom('businesses').select(['id', 'name', 'short_name']).orderBy('name').execute();
    return rows.map((row) => ({ id: row.id, name: row.name, shortName: row.short_name }));
  }
}
