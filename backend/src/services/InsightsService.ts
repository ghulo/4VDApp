import type { InsightsRepository } from '../repositories/InsightsRepository.js';
import type { ReportsRepository } from '../repositories/ReportsRepository.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import type { ReportsService } from './ReportsService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** A product selling out within this many days is worth a warning. */
const RUNNING_OUT_DAYS = 7;
const URGENT_DAYS = 2;
/** Sold out counts only if it was selling recently; old discontinued stock isn't news. */
const RECENTLY_SOLD_DAYS = 30;
const DEAD_STOCK_DAYS = 60;
const RECENT_SALES_DAYS = 7;
const MISSING_STOCK_DAYS = 30;
const UNUSUAL_SALE = { minQuantity: 5, factor: 4, minHistory: 5, baselineDays: 90 };

export type InsightKind = 'sold_out' | 'running_out' | 'missing_stock' | 'unusual_sale' | 'below_cost' | 'dead_stock';
export type InsightSeverity = 'urgent' | 'warning' | 'info';

export interface Insight {
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  detail: string;
  productId: number;
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = { urgent: 0, warning: 1, info: 2 };
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Things the owner should look at, worked out fresh from sales, stock, counts and write-offs. */
export class InsightsService {
  constructor(
    private readonly insightsRepository: InsightsRepository,
    private readonly reportsRepository: ReportsRepository,
    private readonly reportsService: ReportsService,
  ) {}

  async list(now = new Date()): Promise<Insight[]> {
    const daysAgo = (days: number) => new Date(now.getTime() - days * MS_PER_DAY);
    const [forecasts, products, belowCost, unusual, missing] = await Promise.all([
      this.reportsService.reorderSuggestions(now),
      this.reportsRepository.activeProducts(),
      this.insightsRepository.salesBelowCost(daysAgo(RECENT_SALES_DAYS)),
      this.insightsRepository.unusualSales({
        since: daysAgo(RECENT_SALES_DAYS),
        baselineSince: daysAgo(UNUSUAL_SALE.baselineDays),
        minQuantity: UNUSUAL_SALE.minQuantity,
        factor: UNUSUAL_SALE.factor,
        minHistory: UNUSUAL_SALE.minHistory,
      }),
      this.insightsRepository.missingStock(daysAgo(MISSING_STOCK_DAYS)),
    ]);
    const insights: Insight[] = [];

    for (const row of forecasts) {
      const soldRecently = row.lastSoldAt !== null && new Date(row.lastSoldAt) >= daysAgo(RECENTLY_SOLD_DAYS);
      if (row.quantity === 0 && soldRecently) {
        insights.push({
          kind: 'sold_out',
          severity: 'urgent',
          title: `${row.productName} is sold out`,
          detail: `It was selling about ${row.averageDailySales} a day. Order about ${row.suggestedOrder}.`,
          productId: row.productId,
        });
      } else if (row.quantity > 0 && row.daysLeft !== null && row.daysLeft <= RUNNING_OUT_DAYS) {
        const when = row.daysLeft === 0 ? 'today' : `in about ${plural(row.daysLeft, 'day', 'days')}`;
        const pace = row.trend === 'rising' ? ', and picking up' : '';
        insights.push({
          kind: 'running_out',
          severity: row.daysLeft <= URGENT_DAYS ? 'urgent' : 'warning',
          title: `${row.productName} runs out ${when}`,
          detail: `${row.quantity} left, selling about ${row.averageDailySales} a day${pace}. Order about ${row.suggestedOrder}.`,
          productId: row.productId,
        });
      }
    }

    for (const row of missing) {
      const times = Number(row.times);
      insights.push({
        kind: 'missing_stock',
        severity: times >= 2 ? 'urgent' : 'warning',
        title: `${plural(Number(row.units), 'unit', 'units')} of ${row.product_name} went missing`,
        detail: `${times === 1 ? 'Once' : `${times} times`} in the last ${MISSING_STOCK_DAYS} days, from counts that came up short or stock reported lost.`,
        productId: row.product_id,
      });
    }

    for (const row of unusual) {
      insights.push({
        kind: 'unusual_sale',
        severity: 'warning',
        title: `Unusually big sale: ${row.quantity_sold} × ${row.product_name}`,
        detail: `Sale #${row.sale_id}${row.sold_by_name ? ` by ${row.sold_by_name}` : ''}. A sale is usually about ${Number(row.usual_quantity)}. Check it wasn't a typing mistake.`,
        productId: row.product_id,
      });
    }

    for (const row of belowCost) {
      insights.push({
        kind: 'below_cost',
        severity: 'warning',
        title: `${row.product_name} sold below cost`,
        detail: `${plural(Number(row.sales_count), 'sale', 'sales')} in the last ${RECENT_SALES_DAYS} days brought in ${formatEuro(roundMoney(Number(row.shortfall)))} less than cost. Check its price and promotions.`,
        productId: row.product_id,
      });
    }

    for (const row of products) {
      const isOldEnough = row.created_at <= daysAgo(DEAD_STOCK_DAYS);
      const isUnsold = row.last_sold_at === null || row.last_sold_at <= daysAgo(DEAD_STOCK_DAYS);
      if (row.quantity_on_hand > 0 && isOldEnough && isUnsold) {
        const tiedUp = row.cost_price === null ? null : roundMoney(row.quantity_on_hand * Number(row.cost_price));
        insights.push({
          kind: 'dead_stock',
          severity: 'info',
          title: `${row.product_name} hasn't sold in ${DEAD_STOCK_DAYS}+ days`,
          detail: `${row.quantity_on_hand} in stock${tiedUp === null ? '' : `, ${formatEuro(tiedUp)} tied up at cost`}. A promotion could move it.`,
          productId: row.product_id,
        });
      }
    }

    return insights.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }
}
