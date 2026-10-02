import { sql } from 'kysely';
import type { DatabaseClient } from '../database/connection.js';

export interface OutboxRow {
  id: number;
  to_address: string;
  subject: string;
  html: string;
  text: string;
}

export class EmailOutboxRepository {
  constructor(private readonly db: DatabaseClient) {}

  async add(email: { to: string; subject: string; html: string; text: string }): Promise<void> {
    await this.db
      .insertInto('email_outbox')
      .values({ to_address: email.to, subject: email.subject, html: email.html, text: email.text })
      .execute();
  }

  /**
   * Take up to `limit` unsent emails that haven't used up their tries, counting
   * this try. SKIP LOCKED lets two servers run this without sending twice.
   */
  async claim(limit: number, maxAttempts: number): Promise<OutboxRow[]> {
    const result = await sql<OutboxRow>`
      update email_outbox set attempts = attempts + 1
      where id in (
        select id from email_outbox
        where sent_at is null and attempts < ${maxAttempts}
        order by id
        limit ${limit}
        for update skip locked
      )
      returning id, to_address, subject, html, text
    `.execute(this.db);
    return result.rows;
  }

  async markSent(id: number): Promise<void> {
    await this.db.updateTable('email_outbox').set({ sent_at: new Date(), last_error: null }).where('id', '=', id).execute();
  }

  async markFailed(id: number, error: string): Promise<void> {
    await this.db.updateTable('email_outbox').set({ last_error: error.slice(0, 1000) }).where('id', '=', id).execute();
  }
}
