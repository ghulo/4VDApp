import { NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { InventoryRepository } from '../repositories/InventoryRepository.js';
import type { ProductRepository } from '../repositories/ProductRepository.js';
import type { DateRange, RevenuePeriod, SalesRepository } from '../repositories/SalesRepository.js';
import type { StockAdjustmentRepository } from '../repositories/StockAdjustmentRepository.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TOP_PRODUCTS_LIMIT = 5;
const RECENT_SALES_LIMIT = 10;
const LOW_STOCK_LIMIT = 10;
const STOCK_HISTORY_LIMIT = 30;

/** Keeps charts readable and the query cheap. */
const MAX_BUCKETS: Record<RevenuePeriod, number> = { daily: 366, weekly: 260, monthly: 120 };
const DEFAULT_SPAN_DAYS: Record<RevenuePeriod, number> = { daily: 30, weekly: 7 * 12, monthly: 365 };
const BUCKET_DAYS: Record<RevenuePeriod, number> = { daily: 1, weekly: 7, monthly: 31 };

export class AnalyticsService {
  constructor(
    private readonly salesRepository: SalesRepository,
    private readonly inventoryRepository: InventoryRepository,
    private readonly productRepository: ProductRepository,
    private readonly stockAdjustmentRepository: StockAdjustmentRepository,
  ) {}

  /** Everything the admin overview needs, for the last `days` days. */
  async dashboard(days: number) {
    const range = lastDays(days);
    const [totals, topProducts, recent, lowStock, inventoryValue] = await Promise.all([
      this.salesRepository.totals(range),
      this.salesRepository.topProducts(range, TOP_PRODUCTS_LIMIT),
      this.salesRepository.findMany({ limit: RECENT_SALES_LIMIT, offset: 0 }),
      this.inventoryRepository.findMany({ lowStockOnly: true, limit: LOW_STOCK_LIMIT, offset: 0 }),
      this.inventoryRepository.totalValue(),
    ]);

    return {
      periodDays: days,
      totalSales: totals.salesCount,
      unitsSold: totals.unitsSold,
      totalRevenue: totals.revenue,
      totalProfit: totals.profit,
      topProducts,
      lowStockItems: lowStock.items.map((item) => ({
        productId: item.product_id,
        productName: item.product_name,
        quantity: item.quantity_on_hand,
        reorderLevel: item.reorder_level,
      })),
      lowStockCount: lowStock.total,
      recentSales: recent.sales.map((sale) => ({
        id: sale.id,
        productName: sale.product_name,
        quantity: sale.quantity_sold,
        totalAmount: Number(sale.total_amount),
        saleDate: sale.sale_date.toISOString(),
      })),
      inventoryValue,
    };
  }

  async revenue(period: RevenuePeriod, startDate?: Date, endDate?: Date, productId?: number) {
    const range = this.resolveRange(period, startDate, endDate);
    const points = await this.salesRepository.revenueByPeriod(period, range, productId);
    return {
      period,
      startDate: range.startDate.toISOString(),
      endDate: range.endDate.toISOString(),
      totalRevenue: points.reduce((sum, point) => sum + point.revenue, 0),
      points,
    };
  }

  async product(productId: number) {
    const product = await this.productRepository.findById(productId, true);
    if (!product) throw new NotFoundError(`Product ${productId} does not exist`);

    const yearRange = lastDays(365);
    const [allTime, lastYear, monthlyTrend, stockHistory] = await Promise.all([
      this.salesRepository.findMany({ productId, limit: 1, offset: 0 }),
      this.salesRepository.findMany({ productId, ...yearRange, limit: 1, offset: 0 }),
      this.salesRepository.revenueByPeriod('monthly', yearRange, productId),
      this.stockAdjustmentRepository.findRecentForProduct(productId, STOCK_HISTORY_LIMIT),
    ]);

    return {
      productId,
      productName: product.name,
      salesCount: allTime.total,
      revenue: allTime.revenue,
      revenueLast12Months: lastYear.revenue,
      currentStock: product.quantity_on_hand ?? 0,
      monthlyTrend,
      stockHistory: stockHistory.map((entry) => ({
        quantity: entry.adjustment_quantity,
        reason: entry.reason,
        date: entry.adjustment_date.toISOString(),
      })),
    };
  }

  private resolveRange(period: RevenuePeriod, startDate?: Date, endDate?: Date): DateRange {
    const end = endDate ?? new Date();
    const start = startDate ?? new Date(end.getTime() - DEFAULT_SPAN_DAYS[period] * MS_PER_DAY);

    if (start >= end) throw new ValidationError('startDate must be before endDate');
    const buckets = (end.getTime() - start.getTime()) / (BUCKET_DAYS[period] * MS_PER_DAY);
    if (buckets > MAX_BUCKETS[period]) {
      throw new ValidationError(`That range is too long for ${period} data. Pick a shorter range or a longer period.`);
    }
    return { startDate: start, endDate: end };
  }
}

function lastDays(days: number): DateRange {
  const endDate = new Date();
  return { startDate: new Date(endDate.getTime() - days * MS_PER_DAY), endDate };
}
