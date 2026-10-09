import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { Language } from '../i18n/language.js';
import { OVERSEER_ROLES } from '../utils/roles.js';

export interface SubscriptionRow {
  daily_enabled: boolean;
  daily_hour: number;
  weekly_enabled: boolean;
  weekly_day: number;
  weekly_hour: number;
  sections: string[] | null;
  email: boolean;
}

export interface Recipient extends SubscriptionRow {
  user_id: number;
  name: string;
  email_address: string;
  language: Language;
  last_daily: string | null;
  last_weekly: string | null;
}

/** What someone gets before they change anything. */
export const DEFAULT_SUBSCRIPTION: SubscriptionRow = {
  daily_enabled: true,
  daily_hour: 21,
  weekly_enabled: true,
  weekly_day: 1,
  weekly_hour: 8,
  sections: null,
  email: false,
};

export class ReportSubscriptionRepository {
  constructor(private readonly db: DatabaseClient) {}

  async find(userId: number): Promise<SubscriptionRow> {
    const row = await this.db
      .selectFrom('report_subscriptions')
      .select(['daily_enabled', 'daily_hour', 'weekly_enabled', 'weekly_day', 'weekly_hour', 'sections', 'email'])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row ?? DEFAULT_SUBSCRIPTION;
  }

  async save(userId: number, row: SubscriptionRow): Promise<void> {
    await this.db
      .insertInto('report_subscriptions')
      .values({ user_id: userId, ...row })
      .onConflict((oc) => oc.column('user_id').doUpdateSet(row))
      .execute();
  }

  /** Every active owner, admin and developer with their choices (the defaults when they never changed them). */
  async recipients(): Promise<Recipient[]> {
    const rows = await this.db
      .selectFrom('users as u')
      .leftJoin('report_subscriptions as r', 'r.user_id', 'u.id')
      .select([
        'u.id as user_id',
        'u.name',
        'u.email as email_address',
        'u.language',
        'r.daily_enabled',
        'r.daily_hour',
        'r.weekly_enabled',
        'r.weekly_day',
        'r.weekly_hour',
        'r.sections',
        'r.email',
        sql<string | null>`to_char(r.last_daily, 'YYYY-MM-DD')`.as('last_daily'),
        sql<string | null>`to_char(r.last_weekly, 'YYYY-MM-DD')`.as('last_weekly'),
      ])
      .where('u.role', 'in', OVERSEER_ROLES)
      .where('u.is_active', '=', true)
      .where('u.deleted_at', 'is', null)
      .execute();
    return rows.map((row) => ({
      user_id: row.user_id,
      name: row.name,
      email_address: row.email_address,
      language: row.language,
      last_daily: row.last_daily,
      last_weekly: row.last_weekly,
      daily_enabled: row.daily_enabled ?? DEFAULT_SUBSCRIPTION.daily_enabled,
      daily_hour: row.daily_hour ?? DEFAULT_SUBSCRIPTION.daily_hour,
      weekly_enabled: row.weekly_enabled ?? DEFAULT_SUBSCRIPTION.weekly_enabled,
      weekly_day: row.weekly_day ?? DEFAULT_SUBSCRIPTION.weekly_day,
      weekly_hour: row.weekly_hour ?? DEFAULT_SUBSCRIPTION.weekly_hour,
      sections: row.sections ?? null,
      email: row.email ?? DEFAULT_SUBSCRIPTION.email,
    }));
  }

  /**
   * Mark today's report as sent for this person. False when it already went
   * out today, so restarts and a second server never send it twice.
   */
  async claim(userId: number, kind: 'daily' | 'weekly', day: string): Promise<boolean> {
    const column = kind === 'daily' ? 'last_daily' : 'last_weekly';
    const result = await sql<{ user_id: number }>`
      insert into report_subscriptions (user_id, ${sql.ref(column)}) values (${userId}, ${day}::date)
      on conflict (user_id) do update set ${sql.ref(column)} = excluded.${sql.ref(column)}
      where report_subscriptions.${sql.ref(column)} is distinct from excluded.${sql.ref(column)}
      returning user_id
    `.execute(this.db);
    return result.rows.length > 0;
  }
}
