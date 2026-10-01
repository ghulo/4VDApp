import type { DatabaseClient } from '../database/connection.js';

export class SettingsRepository {
  constructor(private readonly db: DatabaseClient) {}

  async all(): Promise<Map<string, unknown>> {
    const rows = await this.db.selectFrom('settings').select(['key', 'value']).execute();
    return new Map(rows.map((row) => [row.key, row.value]));
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
