import type { DatabaseClient } from '../database/connection.js';
import type { NotificationRow } from '../database/types.js';

export interface NewNotification {
  title: string;
  message: string;
  type: string;
}

export class NotificationRepository {
  constructor(private readonly db: DatabaseClient) {}

  async createForUser(userId: number, notification: NewNotification): Promise<void> {
    await this.db.insertInto('notifications').values({ user_id: userId, ...notification }).execute();
  }

  /** Send the same notification to every active user with one of the roles. */
  async createForRoles(roles: Array<'admin' | 'employee' | 'family'>, notification: NewNotification): Promise<number> {
    const result = await this.db
      .insertInto('notifications')
      .columns(['user_id', 'title', 'message', 'type'])
      .expression((eb) =>
        eb
          .selectFrom('users')
          .select([
            'id',
            eb.val(notification.title).as('title'),
            eb.val(notification.message).as('message'),
            eb.val(notification.type).as('type'),
          ])
          .where('role', 'in', roles)
          .where('is_active', '=', true)
          .where('deleted_at', 'is', null),
      )
      .executeTakeFirst();
    return Number(result.numInsertedOrUpdatedRows ?? 0n);
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

  async markAllRead(userId: number): Promise<void> {
    await this.db
      .updateTable('notifications')
      .set({ is_read: true })
      .where('user_id', '=', userId)
      .where('is_read', '=', false)
      .execute();
  }
}
