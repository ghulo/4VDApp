import type { ReportsRepository, TotalsRow } from '../repositories/ReportsRepository.js';
import { roundMoney } from '../utils/money.js';
import {
  type DateRange,
  margin,
  previousRange,
  REORDER_WINDOW_DAYS,
  relativeChange,
  reorderSuggestion,
} from './reports/calculations.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MY_RECENT_SALES_LIMIT = 10;

export interface PeriodTotals {
  revenue: number;
  revenueWithoutCost: number;
  cost: number;
  profit: number;
  margin: number | null;
  unitsSold: number;
  salesCount: number;
}

export interface TeamRow {
  userId: number;
  name: string;
  role: string;
  salesCount: number;
  unitsSold: number;
  revenue: number;
  profit: number;
  averageSale: number;
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
}

function toPeriodTotals(row: TotalsRow): PeriodTotals {
  const revenue = Number(row.revenue);
  const revenueWithoutCost = Number(row.revenue_without_cost);
  const profit = Number(row.profit);
  return {
    revenue,
    revenueWithoutCost,
    cost: Number(row.cost),
    profit,
    margin: margin(profit, revenue - revenueWithoutCost),
    unitsSold: Number(row.units_sold),
    salesCount: Number(row.sales_count),
  };
}

export class ReportsService {
  constructor(private readonly reportsRepository: ReportsRepository) {}

  async summary(range: DateRange) {
    const [currentRow, previousRow] = await Promise.all([
      this.reportsRepository.totals(range),
      this.reportsRepository.totals(previousRange(range)),
    ]);
    const current = toPeriodTotals(currentRow);
    const previous = toPeriodTotals(previousRow);
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
      return {
        userId: row.user_id,
        name: row.name,
        role: row.role,
        salesCount,
        unitsSold: Number(row.units_sold),
        revenue,
        profit: Number(row.profit),
        averageSale: salesCount === 0 ? 0 : roundMoney(revenue / salesCount),
      };
    });
  }

  async profit(range: DateRange, groupBy: 'product' | 'category'): Promise<ProfitRow[]> {
    const rows = await this.reportsRepository.profitBy(range, groupBy);
    return rows.map((row) => {
      const revenue = Number(row.revenue);
      const cost = Number(row.cost);
      const profit = Number(row.profit);
      // Margin is only meaningful when every sale in the group had a known cost.
      return {
        id: row.id,
        name: row.name,
        unitsSold: Number(row.units_sold),
        revenue,
        cost,
        profit,
        margin: row.has_unknown_cost ? null : margin(profit, revenue),
        hasUnknownCost: row.has_unknown_cost,
      };
    });
  }

  async reorderSuggestions(): Promise<ReorderRow[]> {
    const since = new Date(Date.now() - REORDER_WINDOW_DAYS * MS_PER_DAY);
    const rows = await this.reportsRepository.salesVelocity(since);
    return rows
      .map((row) => ({
        productId: row.product_id,
        productName: row.product_name,
        quantity: row.quantity_on_hand,
        reorderLevel: row.reorder_level,
        ...reorderSuggestion({
          unitsSoldLast30Days: Number(row.units_sold_recently),
          quantity: row.quantity_on_hand,
          reorderLevel: row.reorder_level,
        }),
      }))
      .sort((a, b) => {
        if (a.daysLeft === null && b.daysLeft === null) return a.productName.localeCompare(b.productName);
        if (a.daysLeft === null) return 1;
        if (b.daysLeft === null) return -1;
        return a.daysLeft - b.daysLeft;
      });
  }

  /** The caller's own numbers. Deliberately no cost or profit. */
  async mySales(userId: number, range: DateRange) {
    const [currentRow, previousRow, recent] = await Promise.all([
      this.reportsRepository.totals(range, userId),
      this.reportsRepository.totals(previousRange(range), userId),
      this.reportsRepository.recentSalesBy(userId, range, MY_RECENT_SALES_LIMIT),
    ]);
    const pick = (row: TotalsRow) => ({
      salesCount: Number(row.sales_count),
      unitsSold: Number(row.units_sold),
      revenue: Number(row.revenue),
    });
    return {
      current: pick(currentRow),
      previous: pick(previousRow),
      recentSales: recent.map((sale) => ({
        id: sale.id,
        productName: sale.product_name,
        quantity: sale.quantity_sold,
        totalAmount: Number(sale.total_amount),
        saleDate: sale.sale_date.toISOString(),
      })),
    };
  }
}
