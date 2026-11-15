import type { CarwashRepository } from '../repositories/CarwashRepository.js';
import type { StockDocumentExportRow } from './StockDocumentService.js';
import type { StockMoveExportRow } from './StockMoveService.js';
import type { ExpenseRecord, ExpenseRepository } from '../repositories/ExpenseRepository.js';
import type { PriceRow } from '../repositories/ProductRepository.js';
import type { ReportsRepository, SaleExportRow, VelocityRow } from '../repositories/ReportsRepository.js';
import { levelPrice } from './pricing/salePrice.js';
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

const PRICE_COLUMNS: ExportColumn<PriceRow>[] = [
  { header: 'Code', value: (row) => row.sku },
  { header: 'Barcode', value: (row) => row.barcode },
  { header: 'Product', value: (row) => row.name },
  { header: 'Category', value: (row) => row.category_name },
  { header: 'Unit', value: (row) => row.unit },
  { header: 'VAT %', kind: 'number', value: (row) => row.vat_rate },
  { header: 'Cost', kind: 'money', value: (row) => (row.cost_price === null ? null : Number(row.cost_price)) },
  { header: 'Wholesale price', kind: 'money', value: (row) => (row.wholesale_price === null ? null : Number(row.wholesale_price)) },
  { header: 'Shelf price', kind: 'money', value: (row) => Number(row.base_price) },
];

const PRICE_LIST_WORDS = {
  en: {
    title: 'Price list',
    subtitle: (day: string) => `Prices on ${day}, VAT included`,
    category: 'Category',
    product: 'Product',
    barcode: 'Barcode',
    unit: 'Unit',
    piece: 'piece',
    shelf: 'Price',
    wholesale: 'Wholesale price',
    shelfFile: 'price-list',
    wholesaleFile: 'wholesale-price-list',
  },
  sq: {
    title: 'Lista e çmimeve',
    subtitle: (day: string) => `Çmimet më ${day}, me TVSH`,
    category: 'Kategoria',
    product: 'Produkti',
    barcode: 'Barkodi',
    unit: 'Njësia',
    piece: 'copë',
    shelf: 'Çmimi',
    wholesale: 'Çmimi me shumicë',
    shelfFile: 'lista-e-cmimeve',
    wholesaleFile: 'lista-me-shumice',
  },
} as const;

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

const STOCK_DOCUMENT_REASON_WORDS: Record<StockDocumentExportRow['reason'], string> = {
  found: 'found in stock',
  received_free: 'received free',
  own_use: 'used in the shop',
  given_away: 'given away',
  other: 'other',
};

const STOCK_DOCUMENT_COLUMNS: ExportColumn<StockDocumentExportRow>[] = [
  { header: 'Date', kind: 'date', value: (row) => row.day },
  { header: 'Number', value: (row) => row.number },
  { header: 'In or out', value: (row) => (row.direction === 'in' ? 'in' : 'out') },
  { header: 'Why', value: (row) => STOCK_DOCUMENT_REASON_WORDS[row.reason] },
  { header: 'Product', value: (row) => row.product },
  { header: 'Quantity', value: (row) => (row.direction === 'in' ? row.quantity : -row.quantity) },
  { header: 'Unit', value: (row) => row.unit },
  { header: 'Cost each', kind: 'money', value: (row) => row.unit_cost },
  { header: 'Value at cost', kind: 'money', total: true, value: (row) => (row.voided || row.value === null ? null : row.direction === 'in' ? row.value : -row.value) },
  { header: 'Note', value: (row) => row.note },
  { header: 'Voided', value: (row) => (row.voided ? 'yes' : 'no') },
];

const STOCK_MOVE_COLUMNS: ExportColumn<StockMoveExportRow>[] = [
  { header: 'Date', kind: 'date', value: (row) => row.day },
  { header: 'Number', value: (row) => row.number },
  { header: 'From', value: (row) => row.from },
  { header: 'To', value: (row) => row.to },
  { header: 'Product', value: (row) => row.product },
  { header: 'Quantity', value: (row) => row.quantity },
  { header: 'Unit', value: (row) => row.unit },
  { header: 'Note', value: (row) => row.note },
  { header: 'Voided', value: (row) => (row.voided ? 'yes' : 'no') },
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
    private readonly priceRows: () => Promise<PriceRow[]>,
    private readonly stockDocumentLines: (from: string, to: string) => Promise<StockDocumentExportRow[]>,
    private readonly stockMoveLines: (from: string, to: string) => Promise<StockMoveExportRow[]> = async () => [],
  ) {}

  /** Every product's prices, in the shape the Prices page reads back in (change the prices, upload the file). */
  async prices(timeZone: string): Promise<ExportFile> {
    const rows = await this.priceRows();
    const today = zonedDay(new Date(), timeZone);
    return {
      basename: `4vd-prices-${today}`,
      sheet: { name: 'Prices', subtitle: `Prices on ${readableRange(today, today)}, VAT included. Change the prices and upload the file on the Prices page.`, columns: PRICE_COLUMNS, rows, totals: { inCsv: false } },
    };
  }

  /** A list to hand to customers: the products shown in the app at one price level, by category, in their language. */
  async priceList(input: { level: 'shelf' | 'wholesale'; categoryId?: number; lang: 'en' | 'sq' }, timeZone: string): Promise<ExportFile> {
    const words = PRICE_LIST_WORDS[input.lang];
    const rows = (await this.priceRows())
      .filter((row) => row.is_active && (input.categoryId === undefined || row.category_id === input.categoryId))
      .sort((a, b) => a.category_name.localeCompare(b.category_name) || a.name.localeCompare(b.name));
    const today = zonedDay(new Date(), timeZone);
    const columns: ExportColumn<PriceRow>[] = [
      { header: words.category, value: (row) => row.category_name },
      { header: words.product, value: (row) => row.name },
      { header: words.barcode, value: (row) => row.barcode },
      { header: words.unit, value: (row) => (row.unit === 'piece' ? words.piece : row.unit) },
      {
        header: input.level === 'wholesale' ? words.wholesale : words.shelf,
        kind: 'money',
        value: (row) => levelPrice(Number(row.base_price), row.wholesale_price === null ? null : Number(row.wholesale_price), input.level === 'wholesale'),
      },
    ];
    return {
      basename: `4vd-${input.level === 'wholesale' ? words.wholesaleFile : words.shelfFile}-${today}`,
      sheet: { name: words.title, subtitle: words.subtitle(readableRange(today, today)), columns, rows, totals: { inCsv: false } },
    };
  }

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

  /** Stock in and out documents, one row per line; voided ones stay, marked, and count nothing. */
  async stockDocuments(range: DateRange, timeZone: string): Promise<ExportFile> {
    const { from, to } = zonedDays(range, timeZone);
    const rows = await this.stockDocumentLines(from, to);
    return {
      basename: `4vd-stock-in-out-${from}-to-${to}`,
      sheet: { name: 'Stock in and out', subtitle: readableRange(from, to), columns: STOCK_DOCUMENT_COLUMNS, rows, totals: { inCsv: false } },
    };
  }

  async stockMoves(range: DateRange, timeZone: string): Promise<ExportFile> {
    const { from, to } = zonedDays(range, timeZone);
    const rows = await this.stockMoveLines(from, to);
    return {
      basename: `4vd-stock-moves-${from}-to-${to}`,
      sheet: { name: 'Stock moved', subtitle: readableRange(from, to), columns: STOCK_MOVE_COLUMNS, rows, totals: { inCsv: false } },
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
