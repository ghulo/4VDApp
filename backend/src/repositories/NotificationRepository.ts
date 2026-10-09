import type { DatabaseClient } from '../database/connection.js';
import type { NotificationRow, UserRole } from '../database/types.js';
import { LANGUAGES } from '../i18n/language.js';
import { messages, type ServerMessages } from '../i18n/messages.js';

/**
 * A notification written once per language: `write` gets the reader's
 * catalogue, so everyone reads it in the language they chose.
 */
export interface NewNotification {
  type: string;
  write: (t: ServerMessages) => { title: string; message: string };
  /** The request it's about, so deciding the request can close it. */
  subject?: NotificationSubject;
  /** The page a tap opens, e.g. "/report?kind=daily&from=2026-10-09". */
  link?: string;
}

export interface NotificationSubject {
  type: 'return' | 'write_off' | 'stock_count';
  id: number;
}

export class NotificationRepository {
  constructor(private readonly db: DatabaseClient) {}

  async createForUser(userId: number, notification: NewNotification): Promise<void> {
    const user = await this.db.selectFrom('users').select('language').where('id', '=', userId).executeTakeFirst();
    if (!user) return;
    const text = notification.write(messages[user.language]);
    await this.db
      .insertInto('notifications')
      .values({
        user_id: userId,
        type: notification.type,
        subject_type: notification.subject?.type ?? null,
        subject_id: notification.subject?.id ?? null,
        link: notification.link ?? null,
        ...text,
      })
      .execute();
  }

  /** Send the same notification to every active user with one of the roles, each in their language. */
  async createForRoles(roles: UserRole[], notification: NewNotification): Promise<number> {
    let sent = 0;
    for (const language of LANGUAGES) {
      const text = notification.write(messages[language]);
      const result = await this.db
        .insertInto('notifications')
        .columns(['user_id', 'title', 'message', 'type', 'subject_type', 'subject_id'])
        .expression((eb) =>
          eb
            .selectFrom('users')
            .select([
              'id',
              eb.val(text.title).as('title'),
              eb.val(text.message).as('message'),
              eb.val(notification.type).as('type'),
              eb.val(notification.subject?.type ?? null).as('subject_type'),
              eb.val(notification.subject?.id ?? null).as('subject_id'),
            ])
            .where('role', 'in', roles)
            .where('language', '=', language)
            .where('is_active', '=', true)
            .where('deleted_at', 'is', null),
        )
        .executeTakeFirst();
      sent += Number(result.numInsertedOrUpdatedRows ?? 0n);
    }
    return sent;
  }

  async findForUser(userId: number, options: { unreadOnly: boolean; limit: number; offset: number }) {
    let query = this.db.selectFrom('notifications').where('user_id', '=', userId);
    if (options.unreadOnly) query = query.where('is_read', '=', false);

    const [notifications, count, unread] = await Promise.all([
      query.selectAll().orderBy('created_at', 'desc').orderBy('id', 'desc').limit(options.limit).offset(options.offset).execute(),
      query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
      this.db
        .selectFrom('notifications')
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .where('user_id', '=', userId)
        .where('is_read', '=', false)
        .executeTakeFirstOrThrow(),
    ]);
    return {
      notifications: notifications as NotificationRow[],
      total: Number(count.total),
      unreadCount: Number(unread.total),
    };
  }

  async markRead(userId: number, notificationId: number): Promise<boolean> {
    const result = await this.db
      .updateTable('notifications')
      .set({ is_read: true })
      .where('id', '=', notificationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  /** Everyone's unread alerts about this request, once it's been decided. */
  async markSubjectRead(subject: NotificationSubject): Promise<void> {
    await this.db
      .updateTable('notifications')
      .set({ is_read: true })
      .where('subject_type', '=', subject.type)
      .where('subject_id', '=', subject.id)
      .where('is_read', '=', false)
      .execute();
  }

  async markAllRead(userId: number): Promise<void> {
    await this.db
      .updateTable('notifications')
      .set({ is_read: true })
      .where('user_id', '=', userId)
      .where('is_read', '=', false)
      .execute();
  }
}
