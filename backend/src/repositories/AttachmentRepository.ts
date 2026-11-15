import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { AttachmentEntity } from '../database/types.js';

export interface AttachmentRecord {
  id: number;
  entity_type: AttachmentEntity;
  entity_id: number;
  media_id: string;
  name: string;
  mime: string;
  size: number;
  added_at: Date;
  added_by_name: string | null;
  removed_at: Date | null;
}

/** Where each kind of record lives, to check it exists before a file goes on it. */
const TABLE: Record<AttachmentEntity, 'supplier_bills' | 'bill_lines' | 'documents' | 'offers' | 'purchase_orders' | 'customers' | 'suppliers' | 'ledger_entries'> = {
  bill: 'supplier_bills',
  // An expense's id is its bill line's id.
  expense: 'bill_lines',
  document: 'documents',
  offer: 'offers',
  order: 'purchase_orders',
  customer: 'customers',
  supplier: 'suppliers',
  entry: 'ledger_entries',
};

export class AttachmentRepository {
  constructor(private readonly db: DatabaseClient) {}

  private rows() {
    return this.db
      .selectFrom('attachments as a')
      .leftJoin('users as u', 'u.id', 'a.added_by')
      .select(['a.id', 'a.entity_type', 'a.entity_id', 'a.media_id', 'a.name', 'a.mime', 'a.size', 'a.added_at', 'a.removed_at', 'u.name as added_by_name']);
  }

  async exists(entity: AttachmentEntity, id: number): Promise<boolean> {
    const row = await this.db
      .selectFrom(TABLE[entity])
      .select(sql<number>`1`.as('one'))
      .where('id', '=', id)
      .executeTakeFirst();
    return row !== undefined;
  }

  list(entity: AttachmentEntity, id: number): Promise<AttachmentRecord[]> {
    return this.rows().where('a.entity_type', '=', entity).where('a.entity_id', '=', id).where('a.removed_at', 'is', null).orderBy('a.added_at').orderBy('a.id').execute();
  }

  find(id: number): Promise<AttachmentRecord | undefined> {
    return this.rows().where('a.id', '=', id).executeTakeFirst();
  }

  async create(input: { entity: AttachmentEntity; entityId: number; mediaId: string; name: string; mime: string; size: number; addedBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('attachments')
      .values({
        entity_type: input.entity,
        entity_id: input.entityId,
        media_id: input.mediaId,
        name: input.name,
        mime: input.mime,
        size: input.size,
        added_by: input.addedBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async setRemoved(id: number, removed: { at: Date; by: number } | null): Promise<void> {
    await this.db
      .updateTable('attachments')
      .set({ removed_at: removed?.at ?? null, removed_by: removed?.by ?? null })
      .where('id', '=', id)
      .execute();
  }

  /** Removed files in the bin, newest first, since `since`. */
  removedSince(since: Date): Promise<AttachmentRecord[]> {
    return this.rows().where('a.removed_at', '>=', since).orderBy('a.removed_at', 'desc').execute();
  }

  /** Files removed before `before`, gone for good with their bytes. */
  async purge(before: Date): Promise<number> {
    const rows = await this.db.deleteFrom('attachments').where('removed_at', '<', before).returning('media_id').execute();
    if (rows.length > 0) await this.db.deleteFrom('media').where('id', 'in', rows.map((row) => row.media_id)).execute();
    return rows.length;
  }
}
