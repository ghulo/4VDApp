import type { ReportsRepository } from '../repositories/ReportsRepository.js';
import type { CarwashService } from './CarwashService.js';
import type { CashCountService } from './CashCountService.js';
import { en, type ServerMessages } from '../i18n/messages.js';
import { roundMoney } from '../utils/money.js';
import { startOfZonedDay } from '../utils/zonedDates.js';
import type { InsightsService } from './InsightsService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DailySummary {
  title: string;
  message: string;
  /** Just the sales sentence, for showing next to the warnings themselves. */
  salesLine: string;
}

/** Today so far in a few sentences, for the Overview page. The full reports are in services/reports. */
export class DailySummaryService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly carwashService: CarwashService,
    private readonly cashCountService: CashCountService,
    private readonly insightsService: InsightsService,
    private readonly timeZone: string,
  ) {}

  /** Today so far against the same weekday last week, the carwash, plus the warnings. */
  async compose(now = new Date(), t: ServerMessages = en): Promise<DailySummary> {
    const startOfToday = startOfZonedDay(now, this.timeZone);
    const weekAgo = (date: Date) => new Date(date.getTime() - 7 * MS_PER_DAY);
    const [today, lastWeek, insights, carwash, cash] = await Promise.all([
      this.reportsRepository.totals({ startDate: startOfToday, endDate: now }),
      this.reportsRepository.totals({ startDate: weekAgo(startOfToday), endDate: weekAgo(now) }),
      this.insightsService.list(now, t),
      this.carwashService.today(now),
      this.cashCountService.summaryLines(now, t),
    ]);
    const names = await this.carwashService.displayNames();
    const salesLine = t.dailySales({
      sales: Number(today.sales_count),
      profit: Number(today.profit),
      lastWeek: Number(lastWeek.revenue),
    });
    const lines = [
      salesLine,
      ...carwash.carwashes.map(({ id, takings }) => {
        const name = names.get(id) ?? null;
        return takings ? t.dailyCarwash({ name, ...takings, total: roundMoney(takings.carwash + takings.change) }) : t.dailyCarwashMissing(name);
      }),
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
