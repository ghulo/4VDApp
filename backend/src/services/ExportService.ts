import type { CarwashRepository } from '../repositories/CarwashRepository.js';
import type { ExpenseRecord, ExpenseRepository } from '../repositories/ExpenseRepository.js';
import type { ReportsRepository, SaleExportRow, VelocityRow } from '../repositories/ReportsRepository.js';
import { roundMoney } from '../utils/money.js';
import type { ExportColumn, Sheet } from '../utils/spreadsheet.js';
import { zonedDateTime, zonedDay, zonedDays } from '../utils/zonedDates.js';
import type { DateRange } from './reports/calculations.js';
import type { ReportsService, TeamRow } from './ReportsService.js';

/** First and last day included in an end-exclusive range, as dates in `timeZone`. */
const dayRangeLabel = (range: DateRange, timeZone: string) =>
  `${zonedDay(range.startDate, timeZone)}-to-${zonedDay(new Date(range.endDate.getTime() - 1), timeZone)}`;

const salesColumns = (timeZone: string): ExportColumn<SaleExportRow>[] => [
  { header: 'Date', kind: 'datetime', value: (row) => zonedDateTime(row.occurred_at, timeZone) },
  { header: 'Product', value: (row) => row.product_name },
  { header: 'SKU', value: (row) => row.sku },
  { header: 'Quantity', kind: 'number', total: true, value: (row) => row.quantity },
  { header: 'Unit price', kind: 'money', value: (row) => Number(row.unit_price) },
  { header: 'Total', kind: 'money', total: true, value: (row) => Number(row.total) },
  { header: 'Unit cost', kind: 'money', value: (row) => (row.unit_cost === null ? null : Number(row.unit_cost)) },
  {
    header: 'Profit',
    kind: 'money',
    total: true,
    value: (row) => (row.unit_cost === null ? null : roundMoney(Number(row.total) - row.quantity * Number(row.unit_cost))),
  },
  { header: 'Sold by', value: (row) => row.sold_by_name },
  { header: 'Notes', value: (row) => row.notes },
  // Last, so the columns people already rely on keep their places.
  { header: 'Type', value: (row) => row.kind },
];

type StockExportRow = VelocityRow & { daysLeft: number | null };

const STOCK_COLUMNS: ExportColumn<StockExportRow>[] = [
  { header: 'Product', value: (row) => row.product_name },
  { header: 'SKU', value: (row) => row.sku },
  { header: 'Category', value: (row) => row.category_name },
  { header: 'In stock', kind: 'number', total: true, value: (row) => row.quantity_on_hand },
  { header: 'Reorder level', kind: 'number', value: (row) => row.reorder_level },
  { header: 'Price', kind: 'money', value: (row) => Number(row.base_price) },
  { header: 'Cost', kind: 'money', value: (row) => (row.cost_price === null ? null : Number(row.cost_price)) },
  // Valued at cost, falling back to the sale price when cost is unknown (same as the dashboard).
  { header: 'Stock value', kind: 'money', total: true, value: (row) => roundMoney(row.quantity_on_hand * Number(row.cost_price ?? row.base_price)) },
  { header: 'Days left', kind: 'number', value: (row) => row.daysLeft },
];

const TEAM_COLUMNS: ExportColumn<TeamRow>[] = [
  { header: 'Name', value: (row) => row.name },
  { header: 'Role', value: (row) => row.role },
  { header: 'Sales', kind: 'number', total: true, value: (row) => row.salesCount },
  { header: 'Units sold', kind: 'number', total: true, value: (row) => row.unitsSold },
  { header: 'Revenue', kind: 'money', total: true, value: (row) => row.revenue },
  { header: 'Refunds', kind: 'money', total: true, value: (row) => row.refunds },
  { header: 'Profit', kind: 'money', total: true, value: (row) => row.profit },
  { header: 'Average sale', kind: 'money', value: (row) => row.averageSale },
  { header: 'Monthly target', kind: 'money', value: (row) => row.monthlyTarget },
  { header: 'Commission %', kind: 'number', value: (row) => row.commissionPercent },
  { header: 'Commission', kind: 'money', total: true, value: (row) => row.commission },
];

/** One day of money in and out, for the accountant. */
interface MoneyDay {
  day: string;
  shop: number;
  carwash: number;
  change: number;
  expenses: number;
}

const MONEY_COLUMNS: ExportColumn<MoneyDay>[] = [
  { header: 'Date', kind: 'date', value: (row) => row.day },
  { header: 'Shop sales (after refunds)', kind: 'money', total: true, value: (row) => row.shop },
  { header: 'Carwash', kind: 'money', total: true, value: (row) => row.carwash },
  { header: 'Change machine', kind: 'money', total: true, value: (row) => row.change },
  { header: 'Expenses', kind: 'money', total: true, value: (row) => row.expenses },
  { header: 'In minus out', kind: 'money', total: true, value: (row) => roundMoney(row.shop + row.carwash + row.change - row.expenses) },
];

const EXPENSE_COLUMNS: ExportColumn<ExpenseRecord>[] = [
  { header: 'Date', kind: 'date', value: (row) => row.day },
  { header: 'What for', value: (row) => row.category },
  { header: 'For', value: (row) => (row.carwash_name ? `carwash: ${row.carwash_name}` : row.place) },
  { header: 'Amount', kind: 'money', total: true, value: (row) => Number(row.amount) },
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

/** A download: its file name without the extension, and the sheet to write as CSV or Excel. */
export interface ExportFile {
  basename: string;
  // Each export has its own row type; the writers only read rows through the columns.
  // oxlint-disable-next-line typescript/no-explicit-any
  sheet: Sheet<any>;
}

/** "1 Mar 2026 to 31 Mar 2026", for the line under a sheet's title. */
function readableRange(from: string, to: string): string {
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return from === to ? day(from) : `${day(from)} to ${day(to)}`;
}

export class ExportService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly reportsService: ReportsService,
    private readonly carwashRepository: CarwashRepository,
    private readonly expenseRepository: ExpenseRepository,
  ) {}

  /** Money in and out per day, shop and carwash together, with a total: what the accountant asks for. */
  async money(range: DateRange, timeZone: string): Promise<ExportFile> {
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

    const rows: MoneyDay[] = eachDay(from, to).map((day) => ({
      day,
      shop: roundMoney(shop.get(day) ?? 0),
      carwash: carwashByDay.get(day)?.carwash ?? 0,
      change: carwashByDay.get(day)?.change ?? 0,
      expenses: spentByDay.get(day) ?? 0,
    }));
    return {
      basename: `4vd-money-${from}-to-${to}`,
      sheet: { name: 'Money', subtitle: `Money in and out per day, ${readableRange(from, to)}`, columns: MONEY_COLUMNS, rows, totals: { inCsv: true } },
    };
  }

  async expenses(range: DateRange, timeZone: string): Promise<ExportFile> {
    const { from, to } = zonedDays(range, timeZone);
    const rows = (await this.expenseRepository.findBetween(from, to)).reverse();
    return {
      basename: `4vd-expenses-${from}-to-${to}`,
      sheet: { name: 'Expenses', subtitle: readableRange(from, to), columns: EXPENSE_COLUMNS, rows, totals: { inCsv: false } },
    };
  }

  async sales(range: DateRange, timeZone: string): Promise<ExportFile> {
    const rows = await this.reportsRepository.salesForExport(range);
    const { from, to } = zonedDays(range, timeZone);
    return {
      basename: `4vd-sales-${dayRangeLabel(range, timeZone)}`,
      sheet: { name: 'Sales', subtitle: readableRange(from, to), columns: salesColumns(timeZone), rows, totals: { inCsv: false } },
    };
  }

  async stock(timeZone: string): Promise<ExportFile> {
    const [products, suggestions] = await Promise.all([
      this.reportsRepository.activeProducts(),
      this.reportsService.reorderSuggestions(),
    ]);
    const daysLeftById = new Map(suggestions.map((row) => [row.productId, row.daysLeft]));
    const rows = products.map((product) => ({ ...product, daysLeft: daysLeftById.get(product.product_id) ?? null }));
    const today = zonedDay(new Date(), timeZone);
    return {
      basename: `4vd-stock-${today}`,
      sheet: { name: 'Stock', subtitle: `On the shelf on ${readableRange(today, today)}`, columns: STOCK_COLUMNS, rows, totals: { inCsv: false } },
    };
  }

  async team(range: DateRange, timeZone: string): Promise<ExportFile> {
    const rows = await this.reportsService.team(range);
    const { from, to } = zonedDays(range, timeZone);
    return {
      basename: `4vd-team-${dayRangeLabel(range, timeZone)}`,
      sheet: { name: 'Team', subtitle: readableRange(from, to), columns: TEAM_COLUMNS, rows, totals: { inCsv: false } },
    };
  }
}
