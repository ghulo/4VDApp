import { sql } from 'kysely';
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

  /** The business a file belongs to (the media table belongs to no business). */
  async ownerOf(id: string): Promise<{ businessId: number | null } | undefined> {
    const row = await this.db.selectFrom('media').select('business_id').where('id', '=', id).executeTakeFirst();
    return row ? { businessId: row.business_id } : undefined;
  }

  /**
   * Whether a file is private: a bill scan, a mailed bill, an attachment, a bill's photo, the stamp or
   * the signature. Logos, profile photos and product photos stay public (emails and the portal show
   * them without a dashboard sign-in). Run it inside the file's business, whose rows it reads.
   */
  async isPrivate(id: string): Promise<boolean> {
    const row = await sql<{ private: boolean }>`
      select (exists (select 1 from attachments a where a.media_id::text = ${id})
        or exists (select 1 from bill_scans s where ${id} = any(s.media_ids))
        or exists (select 1 from bill_emails e where e.media_id = ${id})
        or exists (select 1 from supplier_bills b where b.photo_media_id::text = ${id})
        or exists (select 1 from businesses z where z.stamp_media_id::text = ${id} or z.signature_media_id::text = ${id})) as private`.execute(this.db);
    return row.rows[0]?.private === true;
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
