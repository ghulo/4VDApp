import { NOTIFICATION_TYPES } from '../constants/notifications.js';
import type { NotificationRepository } from '../repositories/NotificationRepository.js';
import type { ReportsRepository } from '../repositories/ReportsRepository.js';
import type { SettingsRepository } from '../repositories/SettingsRepository.js';
import type { CarwashService } from './CarwashService.js';
import type { CashCountService } from './CashCountService.js';
import { LANGUAGES, type Language } from '../i18n/language.js';
import { en, messages, type ServerMessages } from '../i18n/messages.js';
import { roundMoney } from '../utils/money.js';
import { startOfZonedDay, zonedDay, zonedHour } from '../utils/zonedDates.js';
import type { InsightsService } from './InsightsService.js';
import type { SettingsService } from './SettingsService.js';
import { OVERSEER_ROLES } from '../utils/roles.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Remembers the last day a summary went out, so restarts and second servers don't resend it. */
const LAST_SENT_KEY = 'daily_summary_last_sent';

export interface DailySummary {
  title: string;
  message: string;
  /** Just the sales sentence, for showing next to the warnings themselves. */
  salesLine: string;
}

/** The owner's end-of-day message: today's sales and what needs attention. Sent through the alerts. */
export class DailySummaryService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly carwashService: CarwashService,
    private readonly cashCountService: CashCountService,
    private readonly insightsService: InsightsService,
    private readonly settingsService: SettingsService,
    private readonly settingsRepository: SettingsRepository,
    private readonly notificationRepository: NotificationRepository,
    private readonly timeZone: string,
  ) {}

  /**
   * Called every minute by the server. Sends today's summary to every admin
   * once the set hour has passed, at most once a day. True when it sent.
   */
  async sendIfDue(now = new Date()): Promise<boolean> {
    const { dailySummaryHour } = await this.settingsService.get();
    if (zonedHour(now, this.timeZone) < dailySummaryHour) return false;
    if (!(await this.settingsRepository.claim(LAST_SENT_KEY, zonedDay(now, this.timeZone)))) return false;

    const summaries = Object.fromEntries(
      await Promise.all(LANGUAGES.map(async (language) => [language, await this.compose(now, messages[language])] as const)),
    ) as Record<Language, DailySummary>;
    await this.notificationRepository.createForRoles(OVERSEER_ROLES, {
      type: NOTIFICATION_TYPES.DAILY_SUMMARY,
      write: (t) => ({ title: summaries[t.language].title, message: summaries[t.language].message }),
    });
    return true;
  }

  /** Today so far against the same weekday last week, the carwash, plus the warnings. */
  async compose(now = new Date(), t: ServerMessages = en): Promise<DailySummary> {
    const startOfToday = startOfZonedDay(now, this.timeZone);
    const weekAgo = (date: Date) => new Date(date.getTime() - 7 * MS_PER_DAY);
    const [today, lastWeek, insights, carwash, cash] = await Promise.all([
      this.reportsRepository.totals({ startDate: startOfToday, endDate: now }),
      this.reportsRepository.totals({ startDate: weekAgo(startOfToday), endDate: weekAgo(now) }),
      this.insightsService.list(now, t),
      this.carwashService.findDay(zonedDay(now, this.timeZone)),
      this.cashCountService.summaryLines(now, t),
    ]);
    const salesLine = t.dailySales({
      sales: Number(today.sales_count),
      profit: Number(today.profit),
      lastWeek: Number(lastWeek.revenue),
    });
    const lines = [
      salesLine,
      carwash ? t.dailyCarwash({ ...carwash, total: roundMoney(carwash.carwash + carwash.change) }) : t.dailyCarwashMissing,
      ...cash,
    ];
    const urgent = insights.filter((insight) => insight.severity === 'urgent');
    const others = insights.length - urgent.length;
    if (urgent.length > 0) {
      lines.push(t.dailyUrgent({ titles: urgent.slice(0, 2).map((insight) => insight.title), more: Math.max(0, urgent.length - 2) }));
    }
    if (others > 0) lines.push(t.dailyOthers(others));
    if (insights.length === 0) lines.push(t.dailyNothing);

    return { title: t.dailyTitle(Number(today.revenue)), message: lines.join(' '), salesLine };
  }
}
