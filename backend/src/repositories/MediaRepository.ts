import type { DatabaseClient } from '../database/connection.js';

export class MediaRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(media: { businessId: number; mime: string; bytes: Buffer }): Promise<string> {
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

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('media').where('id', '=', id).execute();
  }
}
