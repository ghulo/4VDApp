import { NOTIFICATION_TYPES } from '../constants/notifications.js';
import type { NotificationRepository } from '../repositories/NotificationRepository.js';
import type { ReportsRepository } from '../repositories/ReportsRepository.js';
import type { SettingsRepository } from '../repositories/SettingsRepository.js';
import { formatEuro } from '../utils/money.js';
import { startOfZonedDay, zonedDay, zonedHour } from '../utils/zonedDates.js';
import type { InsightsService } from './InsightsService.js';
import type { SettingsService } from './SettingsService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Remembers the last day a summary went out, so restarts and second servers don't resend it. */
const LAST_SENT_KEY = 'daily_summary_last_sent';

export interface DailySummary {
  title: string;
  message: string;
  /** Just the sales sentence, for showing next to the warnings themselves. */
  salesLine: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The owner's end-of-day message: today's sales and what needs attention. Sent through the alerts. */
export class DailySummaryService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
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

    const summary = await this.compose(now);
    await this.notificationRepository.createForRoles(['admin'], {
      title: summary.title,
      message: summary.message,
      type: NOTIFICATION_TYPES.DAILY_SUMMARY,
    });
    return true;
  }

  /** Today so far against the same weekday last week, plus the warnings. */
  async compose(now = new Date()): Promise<DailySummary> {
    const startOfToday = startOfZonedDay(now, this.timeZone);
    const weekAgo = (date: Date) => new Date(date.getTime() - 7 * MS_PER_DAY);
    const [today, lastWeek, insights] = await Promise.all([
      this.reportsRepository.totals({ startDate: startOfToday, endDate: now }),
      this.reportsRepository.totals({ startDate: weekAgo(startOfToday), endDate: weekAgo(now) }),
      this.insightsService.list(now),
    ]);
    const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: this.timeZone }).format(now);
    const revenue = Number(today.revenue);
    const salesCount = Number(today.sales_count);

    const salesLine = `${plural(salesCount, 'sale', 'sales')}, ${formatEuro(Number(today.profit))} profit. Last ${weekday}: ${formatEuro(Number(lastWeek.revenue))}.`;
    const lines = [salesLine];
    const urgent = insights.filter((insight) => insight.severity === 'urgent');
    const others = insights.length - urgent.length;
    if (urgent.length > 0) lines.push(`Urgent: ${urgent.slice(0, 2).map((insight) => insight.title).join('; ')}${urgent.length > 2 ? ` and ${urgent.length - 2} more` : ''}.`);
    if (others > 0) lines.push(`${plural(others, 'other thing', 'other things')} to look at on the Overview page.`);
    if (insights.length === 0) lines.push('Nothing needs your attention.');

    return { title: `Today: ${formatEuro(revenue)} in sales`, message: lines.join(' '), salesLine };
  }
}
