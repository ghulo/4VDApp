import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export class SettingsRepository {
  constructor(private readonly db: DatabaseClient) {}

  async all(): Promise<Map<string, unknown>> {
    const rows = await this.db.selectFrom('settings').select(['key', 'value']).execute();
    return new Map(rows.map((row) => [row.key, row.value]));
  }

  /**
   * Store `value` under `key` unless it is already there. True for the one
   * caller that changed it, so a once-a-day job runs once even with two servers.
   */
  async claim(key: string, value: unknown): Promise<boolean> {
    const json = JSON.stringify(value);
    const row = await this.db
      .insertInto('settings')
      .values({ key, value: json, updated_at: new Date() })
      .onConflict((oc) =>
        oc
          .column('key')
          .doUpdateSet({ value: json, updated_at: new Date() })
          .where('settings.value', 'is distinct from', sql<string>`${json}::jsonb`),
      )
      .returning('key')
      .executeTakeFirst();
    return row !== undefined;
  }

  async set(key: string, value: unknown, updatedBy: number): Promise<void> {
    const json = JSON.stringify(value);
    await this.db
      .insertInto('settings')
      .values({ key, value: json, updated_by: updatedBy, updated_at: new Date() })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: json, updated_by: updatedBy, updated_at: new Date() }))
      .execute();
  }
}
