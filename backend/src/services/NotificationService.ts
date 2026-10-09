import { NotFoundError } from '../errors/httpErrors.js';
import type { NotificationRepository } from '../repositories/NotificationRepository.js';
import { type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';

export class NotificationService {
  constructor(private readonly notificationRepository: NotificationRepository) {}

  async list(userId: number, query: PageRequest & { unreadOnly: boolean }) {
    const { notifications, total, unreadCount } = await this.notificationRepository.findForUser(userId, {
      unreadOnly: query.unreadOnly,
      limit: query.limit,
      offset: toOffset(query),
    });
    return {
      items: notifications.map((notification) => ({
        id: notification.id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        link: notification.link,
        isRead: notification.is_read,
        createdAt: notification.created_at.toISOString(),
      })),
      meta: toPaginationMeta(query, total),
      unreadCount,
    };
  }

  async markRead(userId: number, notificationId: number): Promise<void> {
    // Scoped to the user, so nobody can mark someone else's notification read.
    const updated = await this.notificationRepository.markRead(userId, notificationId);
    if (!updated) throw new NotFoundError(`Notification ${notificationId} does not exist`);
  }

  markAllRead(userId: number): Promise<void> {
    return this.notificationRepository.markAllRead(userId);
  }
}
