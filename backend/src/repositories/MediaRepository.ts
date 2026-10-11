import type { DatabaseClient } from '../database/connection.js';

export class MediaRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(media: { businessId: number | null; mime: string; bytes: Buffer }): Promise<string> {
    const row = await this.db
      .insertInto('media')
      .values({ business_id: media.businessId, mime: media.mime, bytes: media.bytes })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  findById(id: string): Promise<{ mime: string; bytes: Buffer } | undefined> {
    return this.db.selectFrom('media').select(['mime', 'bytes']).where('id', '=', id).executeTakeFirst();
  }

  /** Just the file types, without loading the files. */
  async findMimes(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.selectFrom('media').select(['id', 'mime']).where('id', 'in', ids).execute();
    return new Map(rows.map((row) => [row.id, row.mime]));
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('media').where('id', '=', id).execute();
  }
}
