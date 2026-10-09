import type { ReportsRepository } from '../repositories/ReportsRepository.js';
import type { SettingsRepository } from '../repositories/SettingsRepository.js';
import type { CarwashService } from './CarwashService.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { dayMonth, money } from '../i18n/language.js';
import { messages, type ServerMessages } from '../i18n/messages.js';
import { roundMoney } from '../utils/money.js';
import { startOfZonedDay, zonedDay, zonedHour } from '../utils/zonedDates.js';
import type { EmailService } from './email/EmailService.js';
import { emailTemplates, type WeeklyReportData } from './email/templates.js';
import type { InsightsService } from './InsightsService.js';
import { relativeChange } from './reports/calculations.js';
import type { ReportsService } from './ReportsService.js';
import type { SettingsService } from './SettingsService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONDAY = 'Mon';
const TOP_PRODUCTS = 5;
/** Remembers the Monday it last went out, so restarts and second servers don't resend it. */
const LAST_SENT_KEY = 'weekly_report_last_sent';

/** Monday's email to the owner: last week's sales, best sellers, the carwash, and what needs attention. */
export class WeeklyReportService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly reportsService: ReportsService,
    private readonly carwashService: CarwashService,
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
    const week = await this.gather(now);
    for (const person of recipients) {
      const t = messages[person.language];
      await this.emailService.queue(person.email, emailTemplates.weeklyReport({ name: person.name.split(' ')[0]!, ...this.write(week, t) }, t));
    }
    return true;
  }

  /** Last Monday to Sunday (shop time), against the week before. */
  private async gather(now: Date) {
    const thisMonday = startOfZonedDay(now, this.timeZone);
    const weekStart = startOfZonedDay(new Date(thisMonday.getTime() - 7 * MS_PER_DAY + MS_PER_DAY / 2), this.timeZone);
    const weekBefore = startOfZonedDay(new Date(weekStart.getTime() - 7 * MS_PER_DAY + MS_PER_DAY / 2), this.timeZone);
    const lastWeek = { startDate: weekStart, endDate: thisMonday };

    const [totals, previous, products, insights, carwash, carwashEach] = await Promise.all([
      this.reportsRepository.totals(lastWeek),
      this.reportsRepository.totals({ startDate: weekBefore, endDate: weekStart }),
      this.reportsService.profit(lastWeek, 'product'),
      this.insightsService.list(now),
      this.carwashService.totals(lastWeek),
      this.carwashService.totalsByCarwash(lastWeek),
    ]);
    const revenue = Number(totals.revenue);
    const change = relativeChange(revenue, Number(previous.revenue));
    return {
      weekStart,
      weekEnd: new Date(thisMonday.getTime() - 1),
      revenue,
      change: change === null ? null : Math.round(change * 100),
      profit: Number(totals.profit),
      salesCount: Number(totals.sales_count),
      topProducts: [...products].sort((a, b) => b.revenue - a.revenue).slice(0, TOP_PRODUCTS),
      warnings: insights.length,
      carwash,
      carwashEach,
    };
  }

  /** The week's numbers in one reader's language. */
  private write(week: Awaited<ReturnType<WeeklyReportService['gather']>>, t: ServerMessages): WeeklyReportData {
    const day = (date: Date) => dayMonth(date, t.language, this.timeZone);
    return {
      weekLabel: `${day(week.weekStart)} – ${day(week.weekEnd)}`,
      revenue: money(week.revenue, t.language),
      change: week.change === null ? null : t.email.weeklyChange(week.change),
      profit: money(week.profit, t.language),
      salesCount: week.salesCount,
      topProducts: week.topProducts.map((product) => ({
        name: product.name,
        revenue: money(product.revenue, t.language),
        units: product.unitsSold,
      })),
      warnings: week.warnings,
      carwash:
        week.carwash.days === 0
          ? t.email.weeklyNoCarwash
          : t.email.weeklyCarwash({
              carwash: money(week.carwash.carwash, t.language),
              change: money(week.carwash.change, t.language),
              total: money(week.carwash.total, t.language),
              together: money(roundMoney(week.revenue + week.carwash.total), t.language),
            }) +
            // With several carwashes, say what each one made.
            (week.carwashEach.length > 1
              ? ` ${t.email.weeklyCarwashEach(week.carwashEach.map((row) => ({ name: row.name, total: money(row.total, t.language) })))}`
              : ''),
      link: this.dashboardUrl,
    };
  }
}
