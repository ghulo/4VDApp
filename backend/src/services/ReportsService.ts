import type { ReportsRepository, StockLossRow, TotalsRow } from '../repositories/ReportsRepository.js';
import { roundMoney } from '../utils/money.js';
import { type DateRange, margin, previousRange, relativeChange } from './reports/calculations.js';
import { FORECAST_HISTORY_DAYS, forecast, type Trend } from './reports/forecast.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MY_RECENT_SALES_LIMIT = 10;

export interface PeriodTotals {
  /** After refunds. */
  revenue: number;
  /** Refunds approved in the period, as a positive amount. */
  refunds: number;
  revenueWithoutCost: number;
  cost: number;
  profit: number;
  margin: number | null;
  unitsSold: number;
  salesCount: number;
  /** Value at cost of stock written off or found missing in counts; a surplus lowers it. */
  stockLosses: number;
  /** Units lost whose product had no cost price, so they have no value above. */
  lossUnitsWithoutCost: number;
}

export interface TeamRow {
  userId: number;
  name: string;
  role: string;
  /** Deactivated or removed since; kept so their past sales still show. */
  hasLeft: boolean;
  salesCount: number;
  unitsSold: number;
  revenue: number;
  refunds: number;
  profit: number;
  averageSale: number;
  monthlyTarget: number | null;
  commissionPercent: number | null;
  /** Revenue after refunds × commission; null when no commission is set. */
  commission: number | null;
}

export interface ProfitRow {
  id: number;
  name: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
  hasUnknownCost: boolean;
}

export interface ReorderRow {
  productId: number;
  productName: string;
  quantity: number;
  reorderLevel: number;
  averageDailySales: number;
  daysLeft: number | null;
  suggestedOrder: number;
  /** Last 2 weeks against the 6 before; null without enough history. */
  trend: Trend | null;
  /** Null when it has never sold. */
  lastSoldAt: string | null;
}

function toPeriodTotals(row: TotalsRow, losses: StockLossRow): PeriodTotals {
  const revenue = Number(row.revenue);
  const revenueWithoutCost = Number(row.revenue_without_cost);
  const profit = Number(row.profit);
  return {
    revenue,
    refunds: Number(row.refunds),
    revenueWithoutCost,
    cost: Number(row.cost),
    profit,
    margin: margin(profit, revenue - revenueWithoutCost),
    unitsSold: Number(row.units_sold),
    salesCount: Number(row.sales_count),
    stockLosses: roundMoney(Number(losses.stock_losses)),
    lossUnitsWithoutCost: Number(losses.loss_units_without_cost),
  };
}

export class ReportsService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    /** The shop's time zone, for busy and quiet days of the week. */
    private readonly timeZone: string,
  ) {}

  /** `compareWith` defaults to the same length of time immediately before `range`. */
  async summary(range: DateRange, compareWith: DateRange = previousRange(range)) {
    const [currentRow, previousRow, currentLosses, previousLosses] = await Promise.all([
      this.reportsRepository.totals(range),
      this.reportsRepository.totals(compareWith),
      this.reportsRepository.stockLosses(range),
      this.reportsRepository.stockLosses(compareWith),
    ]);
    const current = toPeriodTotals(currentRow, currentLosses);
    const previous = toPeriodTotals(previousRow, previousLosses);
    return {
      current,
      previous,
      change: {
        revenue: relativeChange(current.revenue, previous.revenue),
        profit: relativeChange(current.profit, previous.profit),
        unitsSold: relativeChange(current.unitsSold, previous.unitsSold),
        salesCount: relativeChange(current.salesCount, previous.salesCount),
      },
    };
  }

  async team(range: DateRange): Promise<TeamRow[]> {
    const rows = await this.reportsRepository.team(range);
    return rows.map((row) => {
      const salesCount = Number(row.sales_count);
      const revenue = Number(row.revenue);
      const commissionPercent = row.commission_percent === null ? null : Number(row.commission_percent);
      return {
        userId: row.user_id,
        name: row.name,
        role: row.role,
        hasLeft: row.has_left,
        salesCount,
        unitsSold: Number(row.units_sold),
        revenue,
        refunds: Number(row.refunds),
        profit: Number(row.profit),
        averageSale: salesCount === 0 ? 0 : roundMoney(revenue / salesCount),
        monthlyTarget: row.monthly_target === null ? null : Number(row.monthly_target),
        commissionPercent,
        commission: commissionPercent === null ? null : roundMoney((revenue * commissionPercent) / 100),
      };
    });
  }

  async profit(range: DateRange, groupBy: 'product' | 'category'): Promise<ProfitRow[]> {
    const rows = await this.reportsRepository.profitBy(range, groupBy);
    return rows.map((row) => {
      const revenue = Number(row.revenue);
      const cost = Number(row.cost);
      const profit = Number(row.profit);
      // Sales without a known cost are left out of the margin, as in the summary.
      return {
        id: row.id,
        name: row.name,
        unitsSold: Number(row.units_sold),
        revenue,
        cost,
        profit,
        margin: margin(profit, Number(row.revenue_with_cost)),
        hasUnknownCost: row.has_unknown_cost,
      };
    });
  }

  /** Every active product: when it runs out at the current pace, and how many to order. Soonest first. */
  async reorderSuggestions(now = new Date()): Promise<ReorderRow[]> {
    const [products, sales] = await Promise.all([
      this.reportsRepository.activeProducts(),
      this.reportsRepository.salesSince(new Date(now.getTime() - FORECAST_HISTORY_DAYS * MS_PER_DAY)),
    ]);
    const salesByProduct = new Map<number, Array<{ at: Date; units: number }>>();
    for (const sale of sales) {
      const list = salesByProduct.get(sale.product_id) ?? [];
      list.push({ at: sale.sale_date, units: sale.quantity_sold });
      salesByProduct.set(sale.product_id, list);
    }

    return products
      .map((row) => ({
        productId: row.product_id,
        productName: row.product_name,
        quantity: row.quantity_on_hand,
        reorderLevel: row.reorder_level,
        ...forecast({
          sales: salesByProduct.get(row.product_id) ?? [],
          now,
          availableSince: row.created_at,
          stock: row.quantity_on_hand,
          reorderLevel: row.reorder_level,
          timeZone: this.timeZone,
        }),
        lastSoldAt: row.last_sold_at?.toISOString() ?? null,
      }))
      .sort((a, b) => {
        if (a.daysLeft === null && b.daysLeft === null) return a.productName.localeCompare(b.productName);
        if (a.daysLeft === null) return 1;
        if (b.daysLeft === null) return -1;
        return a.daysLeft - b.daysLeft;
      });
  }

  /** The caller's own numbers. Deliberately no cost or profit. */
  async mySales(userId: number, range: DateRange, compareWith: DateRange = previousRange(range)) {
    const [currentRow, previousRow, recent, monthlyTarget] = await Promise.all([
      this.reportsRepository.totals(range, userId),
      this.reportsRepository.totals(compareWith, userId),
      this.reportsRepository.recentSalesBy(userId, range, MY_RECENT_SALES_LIMIT),
      this.reportsRepository.monthlyTarget(userId),
    ]);
    const pick = (row: TotalsRow) => ({
      salesCount: Number(row.sales_count),
      unitsSold: Number(row.units_sold),
      revenue: Number(row.revenue),
      refunds: Number(row.refunds),
    });
    return {
      monthlyTarget,
      current: pick(currentRow),
      previous: pick(previousRow),
      recentSales: recent.map((sale) => ({
        id: sale.id,
        productName: sale.product_name,
        quantity: sale.quantity_sold,
        pricePerUnit: Number(sale.price_per_unit),
        totalAmount: Number(sale.total_amount),
        saleDate: sale.sale_date.toISOString(),
        returnedQuantity: Number(sale.returned_quantity),
      })),
    };
  }
}
