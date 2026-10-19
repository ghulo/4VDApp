import { NOTIFICATION_TYPES } from '../constants/notifications.js';
import { LANGUAGES } from '../i18n/language.js';
import { messages, type ServerMessages } from '../i18n/messages.js';
import type { NotificationRepository } from '../repositories/NotificationRepository.js';
import { rolesWith } from '../utils/roles.js';
import { zonedHour } from '../utils/zonedDates.js';
import { CLOSING_HOUR } from './AttentionService.js';
import type { DailySummaryService } from './DailySummaryService.js';
import type { DayService } from './DayService.js';

/**
 * Tells the owner, admins and developer once a day, when its last step is
 * done (drawers counted, takings entered, spending added, requests answered),
 * with the day's numbers. Checked every minute from closing time.
 */
export class DayClosedAlert {
  constructor(
    private readonly dayService: DayService,
    private readonly dailySummaryService: DailySummaryService,
    private readonly notifications: NotificationRepository,
    private readonly timeZone: string,
  ) {}

  /** Returns whether the alert went out now. */
  async sendIfClosed(now = new Date()): Promise<boolean> {
    if (zonedHour(now, this.timeZone) < CLOSING_HOUR) return false;
    const day = await this.dayService.forDay('developer', undefined, now);
    if (day.total === 0 || !day.allDone) return false;
    if (!(await this.notifications.claimDayClosing(day.day))) return false;

    try {
      const summaries = new Map<ServerMessages, string>();
      for (const language of LANGUAGES) {
        const t = messages[language];
        summaries.set(t, (await this.dailySummaryService.compose(now, t)).message);
      }
      await this.notifications.createForRoles(rolesWith('oversee'), {
        type: NOTIFICATION_TYPES.DAY_CLOSED,
        write: (t) => ({ title: t.dayClosedTitle, message: summaries.get(t)! }),
        link: `/day?date=${day.day}`,
      });
    } catch (error) {
      // Try again next minute rather than lose the alert.
      await this.notifications.releaseDayClosing(day.day);
      throw error;
    }
    return true;
  }
}
