import type { ReportsRepository, SaleExportRow, VelocityRow } from '../repositories/ReportsRepository.js';
import { type CsvColumn, toCsv } from '../utils/csv.js';
import { roundMoney } from '../utils/money.js';
import type { DateRange } from './reports/calculations.js';
import type { ReportsService, TeamRow } from './ReportsService.js';

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** The last day included in an end-exclusive range, for filenames. */
const lastIncludedDay = (range: DateRange) => isoDay(new Date(range.endDate.getTime() - 1));

const SALES_COLUMNS: CsvColumn<SaleExportRow>[] = [
  { header: 'Date', value: (row) => row.sale_date.toISOString() },
  { header: 'Product', value: (row) => row.product_name },
  { header: 'SKU', value: (row) => row.sku },
  { header: 'Quantity', value: (row) => row.quantity_sold },
  { header: 'Unit price', value: (row) => Number(row.price_per_unit) },
  { header: 'Total', value: (row) => Number(row.total_amount) },
  { header: 'Unit cost', value: (row) => (row.unit_cost === null ? null : Number(row.unit_cost)) },
  {
    header: 'Profit',
    value: (row) =>
      row.unit_cost === null ? null : roundMoney(row.quantity_sold * (Number(row.price_per_unit) - Number(row.unit_cost))),
  },
  { header: 'Sold by', value: (row) => row.sold_by_name },
  { header: 'Notes', value: (row) => row.notes },
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
  { header: 'Profit', value: (row) => row.profit },
  { header: 'Average sale', value: (row) => row.averageSale },
];

export interface CsvFile {
  filename: string;
  content: string;
}

export class ExportService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly reportsService: ReportsService,
  ) {}

  async sales(range: DateRange): Promise<CsvFile> {
    const rows = await this.reportsRepository.salesForExport(range);
    return {
      filename: `4vd-sales-${isoDay(range.startDate)}-to-${lastIncludedDay(range)}.csv`,
      content: toCsv(SALES_COLUMNS, rows),
    };
  }

  async stock(): Promise<CsvFile> {
    const [products, suggestions] = await Promise.all([
      this.reportsRepository.salesVelocity(new Date(0)),
      this.reportsService.reorderSuggestions(),
    ]);
    const daysLeftById = new Map(suggestions.map((row) => [row.productId, row.daysLeft]));
    const rows = products.map((product) => ({ ...product, daysLeft: daysLeftById.get(product.product_id) ?? null }));
    return { filename: `4vd-stock-${isoDay(new Date())}.csv`, content: toCsv(STOCK_COLUMNS, rows) };
  }

  async team(range: DateRange): Promise<CsvFile> {
    const rows = await this.reportsService.team(range);
    return {
      filename: `4vd-team-${isoDay(range.startDate)}-to-${lastIncludedDay(range)}.csv`,
      content: toCsv(TEAM_COLUMNS, rows),
    };
  }
}
