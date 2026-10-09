import type { CarwashRepository } from '../repositories/CarwashRepository.js';
import type { ExpenseRecord, ExpenseRepository } from '../repositories/ExpenseRepository.js';
import type { ReportsRepository, SaleExportRow, VelocityRow } from '../repositories/ReportsRepository.js';
import { type CsvColumn, toCsv } from '../utils/csv.js';
import { roundMoney } from '../utils/money.js';
import { zonedDateTime, zonedDay, zonedDays } from '../utils/zonedDates.js';
import type { DateRange } from './reports/calculations.js';
import type { ReportsService, TeamRow } from './ReportsService.js';

/** First and last day included in an end-exclusive range, as dates in `timeZone`. */
const dayRangeLabel = (range: DateRange, timeZone: string) =>
  `${zonedDay(range.startDate, timeZone)}-to-${zonedDay(new Date(range.endDate.getTime() - 1), timeZone)}`;

const salesColumns = (timeZone: string): CsvColumn<SaleExportRow>[] => [
  { header: 'Date', value: (row) => zonedDateTime(row.occurred_at, timeZone) },
  { header: 'Product', value: (row) => row.product_name },
  { header: 'SKU', value: (row) => row.sku },
  { header: 'Quantity', value: (row) => row.quantity },
  { header: 'Unit price', value: (row) => Number(row.unit_price) },
  { header: 'Total', value: (row) => Number(row.total) },
  { header: 'Unit cost', value: (row) => (row.unit_cost === null ? null : Number(row.unit_cost)) },
  {
    header: 'Profit',
    value: (row) => (row.unit_cost === null ? null : roundMoney(Number(row.total) - row.quantity * Number(row.unit_cost))),
  },
  { header: 'Sold by', value: (row) => row.sold_by_name },
  { header: 'Notes', value: (row) => row.notes },
  // Last, so the columns people already rely on keep their places.
  { header: 'Type', value: (row) => row.kind },
];

type StockExportRow = VelocityRow & { daysLeft: number | null };

const STOCK_COLUMNS: CsvColumn<StockExportRow>[] = [
  { header: 'Product', value: (row) => row.product_name },
  { header: 'SKU', value: (row) => row.sku },
  { header: 'Category', value: (row) => row.category_name },
  { header: 'In stock', value: (row) => row.quantity_on_hand },
  { header: 'Reorder level', value: (row) => row.reorder_level },
  { header: 'Price', value: (row) => Number(row.base_price) },
  { header: 'Cost', value: (row) => (row.cost_price === null ? null : Number(row.cost_price)) },
  // Valued at cost, falling back to the sale price when cost is unknown (same as the dashboard).
  { header: 'Stock value', value: (row) => roundMoney(row.quantity_on_hand * Number(row.cost_price ?? row.base_price)) },
  { header: 'Days left', value: (row) => row.daysLeft },
];

const TEAM_COLUMNS: CsvColumn<TeamRow>[] = [
  { header: 'Name', value: (row) => row.name },
  { header: 'Role', value: (row) => row.role },
  { header: 'Sales', value: (row) => row.salesCount },
  { header: 'Units sold', value: (row) => row.unitsSold },
  { header: 'Revenue', value: (row) => row.revenue },
  { header: 'Refunds', value: (row) => row.refunds },
  { header: 'Profit', value: (row) => row.profit },
  { header: 'Average sale', value: (row) => row.averageSale },
  { header: 'Monthly target', value: (row) => row.monthlyTarget },
  { header: 'Commission %', value: (row) => row.commissionPercent },
  { header: 'Commission', value: (row) => row.commission },
];

/** One day of money in and out, for the accountant. */
interface MoneyDay {
  day: string;
  shop: number;
  carwash: number;
  change: number;
  expenses: number;
}

const MONEY_COLUMNS: CsvColumn<MoneyDay & { label?: string }>[] = [
  { header: 'Date', value: (row) => row.label ?? row.day },
  { header: 'Shop sales (after refunds)', value: (row) => row.shop },
  { header: 'Carwash', value: (row) => row.carwash },
  { header: 'Change machine', value: (row) => row.change },
  { header: 'Expenses', value: (row) => row.expenses },
  { header: 'In minus out', value: (row) => roundMoney(row.shop + row.carwash + row.change - row.expenses) },
];

const EXPENSE_COLUMNS: CsvColumn<ExpenseRecord>[] = [
  { header: 'Date', value: (row) => row.day },
  { header: 'What for', value: (row) => row.category },
  { header: 'For', value: (row) => (row.carwash_name ? `carwash: ${row.carwash_name}` : row.place) },
  { header: 'Amount', value: (row) => Number(row.amount) },
  { header: 'Note', value: (row) => row.note },
  { header: 'Repeats monthly', value: (row) => (row.recurring_id === null ? 'no' : 'yes') },
  { header: 'Added by', value: (row) => row.created_by_name ?? (row.recurring_id === null ? null : 'automatic') },
];

/** Every calendar day from `from` to `to`, both included. */
function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 24 * 60 * 60 * 1000) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

export interface CsvFile {
  filename: string;
  content: string;
}

export class ExportService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly reportsService: ReportsService,
    private readonly carwashRepository: CarwashRepository,
    private readonly expenseRepository: ExpenseRepository,
  ) {}

  /** Money in and out per day, shop and carwash together, with a total: what the accountant asks for. */
  async money(range: DateRange, timeZone: string): Promise<CsvFile> {
    const { from, to } = zonedDays(range, timeZone);
    const [shop, carwash, expenses] = await Promise.all([
      this.reportsRepository.shopRevenueByDay(from, to, timeZone),
      this.carwashRepository.findBetween(from, to),
      this.expenseRepository.findBetween(from, to),
    ]);
    // Several carwashes can have takings on one day; the sheet shows them added together.
    const carwashByDay = new Map<string, { carwash: number; change: number }>();
    for (const row of carwash) {
      const day = carwashByDay.get(row.day) ?? { carwash: 0, change: 0 };
      carwashByDay.set(row.day, {
        carwash: roundMoney(day.carwash + Number(row.carwash_amount)),
        change: roundMoney(day.change + Number(row.change_amount)),
      });
    }
    const spentByDay = new Map<string, number>();
    for (const expense of expenses) spentByDay.set(expense.day, roundMoney((spentByDay.get(expense.day) ?? 0) + Number(expense.amount)));

    const rows: Array<MoneyDay & { label?: string }> = eachDay(from, to).map((day) => ({
      day,
      shop: roundMoney(shop.get(day) ?? 0),
      carwash: carwashByDay.get(day)?.carwash ?? 0,
      change: carwashByDay.get(day)?.change ?? 0,
      expenses: spentByDay.get(day) ?? 0,
    }));
    const sum = (pick: (row: MoneyDay) => number) => roundMoney(rows.reduce((total, row) => total + pick(row), 0));
    rows.push({
      day: '',
      label: 'Total',
      shop: sum((row) => row.shop),
      carwash: sum((row) => row.carwash),
      change: sum((row) => row.change),
      expenses: sum((row) => row.expenses),
    });
    return { filename: `4vd-money-${from}-to-${to}.csv`, content: toCsv(MONEY_COLUMNS, rows) };
  }

  async expenses(range: DateRange, timeZone: string): Promise<CsvFile> {
    const { from, to } = zonedDays(range, timeZone);
    const rows = (await this.expenseRepository.findBetween(from, to)).reverse();
    return { filename: `4vd-expenses-${from}-to-${to}.csv`, content: toCsv(EXPENSE_COLUMNS, rows) };
  }

  async sales(range: DateRange, timeZone: string): Promise<CsvFile> {
    const rows = await this.reportsRepository.salesForExport(range);
    return {
      filename: `4vd-sales-${dayRangeLabel(range, timeZone)}.csv`,
      content: toCsv(salesColumns(timeZone), rows),
    };
  }

  async stock(timeZone: string): Promise<CsvFile> {
    const [products, suggestions] = await Promise.all([
      this.reportsRepository.activeProducts(),
      this.reportsService.reorderSuggestions(),
    ]);
    const daysLeftById = new Map(suggestions.map((row) => [row.productId, row.daysLeft]));
    const rows = products.map((product) => ({ ...product, daysLeft: daysLeftById.get(product.product_id) ?? null }));
    return { filename: `4vd-stock-${zonedDay(new Date(), timeZone)}.csv`, content: toCsv(STOCK_COLUMNS, rows) };
  }

  async team(range: DateRange, timeZone: string): Promise<CsvFile> {
    const rows = await this.reportsService.team(range);
    return {
      filename: `4vd-team-${dayRangeLabel(range, timeZone)}.csv`,
      content: toCsv(TEAM_COLUMNS, rows),
    };
  }
}
