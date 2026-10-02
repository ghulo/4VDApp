import type { ReportsRepository } from '../repositories/ReportsRepository.js';
import type { SettingsRepository } from '../repositories/SettingsRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { formatEuro } from '../utils/money.js';
import { startOfZonedDay, zonedDay, zonedHour } from '../utils/zonedDates.js';
import type { EmailService } from './email/EmailService.js';
import { emailTemplates } from './email/templates.js';
import type { InsightsService } from './InsightsService.js';
import { relativeChange } from './reports/calculations.js';
import type { ReportsService } from './ReportsService.js';
import type { SettingsService } from './SettingsService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONDAY = 'Mon';
const TOP_PRODUCTS = 5;
/** Remembers the Monday it last went out, so restarts and second servers don't resend it. */
const LAST_SENT_KEY = 'weekly_report_last_sent';

/** Monday's email to the owner: last week's sales, best sellers, and what needs attention. */
export class WeeklyReportService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly reportsService: ReportsService,
    private readonly insightsService: InsightsService,
    private readonly settingsService: SettingsService,
    private readonly settingsRepository: SettingsRepository,
    private readonly userRepository: UserRepository,
    private readonly emailService: EmailService,
    private readonly timeZone: string,
    private readonly dashboardUrl: string,
  ) {}

  /** Called every minute by the server. True when it queued this week's emails. */
  async sendIfDue(now = new Date()): Promise<boolean> {
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: this.timeZone }).format(now);
    if (weekday !== MONDAY) return false;
    const { dailySummaryHour } = await this.settingsService.get();
    if (zonedHour(now, this.timeZone) < dailySummaryHour) return false;
    if (!(await this.settingsRepository.claim(LAST_SENT_KEY, zonedDay(now, this.timeZone)))) return false;

    const recipients = await this.userRepository.weeklyReportRecipients();
    if (recipients.length === 0) return true;
    const report = await this.compose(now);
    for (const person of recipients) {
      await this.emailService.queue(person.email, emailTemplates.weeklyReport({ name: person.name.split(' ')[0]!, ...report }));
    }
    return true;
  }

  /** Last Monday to Sunday (shop time), against the week before. */
  private async compose(now: Date) {
    const thisMonday = startOfZonedDay(now, this.timeZone);
    const weekStart = startOfZonedDay(new Date(thisMonday.getTime() - 7 * MS_PER_DAY + MS_PER_DAY / 2), this.timeZone);
    const weekBefore = startOfZonedDay(new Date(weekStart.getTime() - 7 * MS_PER_DAY + MS_PER_DAY / 2), this.timeZone);
    const lastWeek = { startDate: weekStart, endDate: thisMonday };

    const [totals, previous, products, insights] = await Promise.all([
      this.reportsRepository.totals(lastWeek),
      this.reportsRepository.totals({ startDate: weekBefore, endDate: weekStart }),
      this.reportsService.profit(lastWeek, 'product'),
      this.insightsService.list(now),
    ]);
    const revenue = Number(totals.revenue);
    const change = relativeChange(revenue, Number(previous.revenue));
    const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: this.timeZone });

    return {
      weekLabel: `${dayMonth.format(weekStart)} – ${dayMonth.format(new Date(thisMonday.getTime() - 1))}`,
      revenue: formatEuro(revenue),
      change:
        change === null
          ? null
          : `${change >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(change * 100))}% on the week before`,
      profit: formatEuro(Number(totals.profit)),
      salesCount: Number(totals.sales_count),
      topProducts: [...products]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, TOP_PRODUCTS)
        .map((product) => ({ name: product.name, revenue: formatEuro(product.revenue), units: product.unitsSold })),
      warnings: insights.length,
      link: this.dashboardUrl,
    };
  }
}
