import type { InsightsRepository } from '../repositories/InsightsRepository.js';
import type { ReportsRepository } from '../repositories/ReportsRepository.js';
import { roundMoney } from '../utils/money.js';
import { en, type ServerMessages } from '../i18n/messages.js';
import type { ReportsService } from './ReportsService.js';
import { OVERDUE_DAYS, type TabService } from './TabService.js';

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

export type InsightKind = 'sold_out' | 'running_out' | 'missing_stock' | 'unusual_sale' | 'below_cost' | 'dead_stock' | 'tab_overdue';
export type InsightSeverity = 'urgent' | 'warning' | 'info';

export interface Insight {
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** The product it's about; null for insights about a customer's tab. */
  productId: number | null;
  /** Set for tab insights. */
  customerId?: number;
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = { urgent: 0, warning: 1, info: 2 };

/** Things the owner should look at, worked out fresh from sales, stock, counts and write-offs. */
export class InsightsService {
  constructor(
    private readonly insightsRepository: InsightsRepository,
    private readonly reportsRepository: ReportsRepository,
    private readonly reportsService: ReportsService,
    private readonly tabService: TabService,
  ) {}

  /** Written in the reader's language (`t`), English by default. */
  async list(now = new Date(), t: ServerMessages = en): Promise<Insight[]> {
    const daysAgo = (days: number) => new Date(now.getTime() - days * MS_PER_DAY);
    const [forecasts, products, belowCost, unusual, missing, overdueTabs] = await Promise.all([
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
      this.tabService.overdue(now),
    ]);
    const insights: Insight[] = [];

    for (const row of forecasts) {
      const soldRecently = row.lastSoldAt !== null && new Date(row.lastSoldAt) >= daysAgo(RECENTLY_SOLD_DAYS);
      if (row.quantity === 0 && soldRecently) {
        insights.push({
          kind: 'sold_out',
          severity: 'urgent',
          title: t.insight.soldOutTitle(row.productName),
          detail: t.insight.soldOutDetail({ perDay: row.averageDailySales, order: row.suggestedOrder }),
          productId: row.productId,
        });
      } else if (row.quantity > 0 && row.daysLeft !== null && row.daysLeft <= RUNNING_OUT_DAYS) {
        insights.push({
          kind: 'running_out',
          severity: row.daysLeft <= URGENT_DAYS ? 'urgent' : 'warning',
          title: t.insight.runningOutTitle({ product: row.productName, daysLeft: row.daysLeft }),
          detail: t.insight.runningOutDetail({
            left: row.quantity,
            perDay: row.averageDailySales,
            rising: row.trend === 'rising',
            order: row.suggestedOrder,
          }),
          productId: row.productId,
        });
      }
    }

    for (const row of missing) {
      const times = Number(row.times);
      insights.push({
        kind: 'missing_stock',
        severity: times >= 2 ? 'urgent' : 'warning',
        title: t.insight.missingTitle({ product: row.product_name, units: Number(row.units) }),
        detail: t.insight.missingDetail({ times, days: MISSING_STOCK_DAYS }),
        productId: row.product_id,
      });
    }

    for (const row of unusual) {
      insights.push({
        kind: 'unusual_sale',
        severity: 'warning',
        title: t.insight.unusualTitle({ product: row.product_name, quantity: row.quantity_sold }),
        detail: t.insight.unusualDetail({ saleId: row.sale_id, seller: row.sold_by_name, usual: Number(row.usual_quantity) }),
        productId: row.product_id,
      });
    }

    for (const row of belowCost) {
      insights.push({
        kind: 'below_cost',
        severity: 'warning',
        title: t.insight.belowCostTitle(row.product_name),
        detail: t.insight.belowCostDetail({
          sales: Number(row.sales_count),
          days: RECENT_SALES_DAYS,
          shortfall: roundMoney(Number(row.shortfall)),
        }),
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
          title: t.insight.deadStockTitle({ product: row.product_name, days: DEAD_STOCK_DAYS }),
          detail: t.insight.deadStockDetail({ inStock: row.quantity_on_hand, tiedUp }),
          productId: row.product_id,
        });
      }
    }

    for (const customer of overdueTabs) {
      insights.push({
        kind: 'tab_overdue',
        severity: 'warning',
        title: t.insight.tabOverdueTitle({ name: customer.name, amount: customer.balance }),
        detail: t.insight.tabOverdueDetail({ days: Math.floor((now.getTime() - Date.parse(customer.owingSince!)) / MS_PER_DAY), minimum: OVERDUE_DAYS }),
        productId: null,
        customerId: customer.id,
      });
    }

    return insights.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }
}
