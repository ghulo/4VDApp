import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';
import type { BillEmailStatus } from '../database/types.js';

export interface BillEmailRecord {
  id: number;
  message_id: string;
  sender: string;
  subject: string | null;
  file_name: string | null;
  media_id: string | null;
  file_hash: string;
  status: BillEmailStatus;
  error: string | null;
  scan_id: number | null;
  received_at: Date;
  read_at: Date | null;
}

const COLUMNS = ['id', 'message_id', 'sender', 'subject', 'file_name', 'media_id', 'file_hash', 'status', 'error', 'scan_id', 'received_at', 'read_at'] as const;

/** Files that came by email to the shop's bill address. */
export class BillEmailRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Null when this email already brought this file (the mail was delivered twice). */
  async create(input: {
    messageId: string;
    sender: string;
    subject: string | null;
    fileName: string | null;
    mediaId: string | null;
    fileHash: string;
    status: BillEmailStatus;
    firstId?: number | null;
  }): Promise<number | null> {
    const row = await this.db
      .insertInto('bill_emails')
      .values({
        message_id: input.messageId,
        sender: input.sender,
        subject: input.subject,
        file_name: input.fileName,
        media_id: input.mediaId,
        file_hash: input.fileHash,
        status: input.status,
        first_id: input.firstId ?? null,
      })
      .onConflict((conflict) => conflict.columns(['business_id', 'message_id', 'file_hash']).doNothing())
      .returning('id')
      .executeTakeFirst();
    return row?.id ?? null;
  }

  async seen(messageId: string, fileHash: string): Promise<boolean> {
    const row = await this.db.selectFrom('bill_emails').select('id').where('message_id', '=', messageId).where('file_hash', '=', fileHash).executeTakeFirst();
    return row !== undefined;
  }

  /** The first time this file came, from any email. */
  async firstWithHash(fileHash: string): Promise<BillEmailRecord | undefined> {
    return this.db
      .selectFrom('bill_emails')
      .select(COLUMNS)
      .where('file_hash', '=', fileHash)
      // A file removed by mistake can be sent again.
      .where('status', 'not in', ['duplicate', 'removed'])
      .orderBy('received_at')
      .orderBy('id')
      .executeTakeFirst();
  }

  async findById(id: number): Promise<BillEmailRecord | undefined> {
    return this.db.selectFrom('bill_emails').select(COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  /** Oldest first: the first to come is the first read. */
  async waiting(): Promise<BillEmailRecord[]> {
    return this.db.selectFrom('bill_emails').select(COLUMNS).where('status', '=', 'waiting').orderBy('received_at').orderBy('id').execute();
  }

  /** Waiting or failed: what still needs someone. */
  async open(): Promise<BillEmailRecord[]> {
    return this.db.selectFrom('bill_emails').select(COLUMNS).where('status', 'in', ['waiting', 'failed']).orderBy('received_at').orderBy('id').execute();
  }

  /** Reads tried by email on `day` (shop time), read or failed: what counts toward the daily cap. */
  async readsOn(day: string, timeZone: string): Promise<number> {
    const row = await this.db
      .selectFrom('bill_emails')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('read_at', 'is not', null)
      .where(sql<string>`(read_at at time zone ${timeZone})::date`, '=', sql<string>`${day}::date`)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async markRead(id: number, scanId: number, at: Date): Promise<void> {
    await this.db.updateTable('bill_emails').set({ status: 'read', scan_id: scanId, error: null, read_at: at }).where('id', '=', id).execute();
  }

  async markFailed(id: number, error: string, at: Date): Promise<void> {
    await this.db.updateTable('bill_emails').set({ status: 'failed', error, read_at: at }).where('id', '=', id).execute();
  }

  async markRemoved(id: number): Promise<void> {
    await this.db.updateTable('bill_emails').set({ status: 'removed' }).where('id', '=', id).execute();
  }
}
