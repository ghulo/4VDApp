import { ValidationError } from '../errors/httpErrors.js';
import type { PriceRow } from '../repositories/ProductRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { roundMoney } from '../utils/money.js';
import { describeProductChanges, type ProductSnapshot } from './activity/describeProductChanges.js';
import { type Cell, normalise, parseMoney, readCsv, readXlsx } from './money/statementFile.js';
import { markupOf, priceFromCost } from './pricing/priceRules.js';

/** One product's prices as the Prices page shows them (VAT included, like every price in 4VD). */
export interface PriceRowDto {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  otherBarcodes: string[];
  categoryId: number;
  categoryName: string;
  unit: string;
  vatRate: number;
  isActive: boolean;
  cost: number | null;
  wholesalePrice: number | null;
  price: number;
  /** The cheapest bulk price: a new shelf price must stay above it. */
  lowestBulkPrice: number | null;
}

/** New prices for one product; a price left out stays as it is. */
export interface PriceChangeInput {
  productId: number;
  price?: number;
  wholesalePrice?: number | null;
  costPrice?: number | null;
}

/** Why a change can't be saved. */
export type PriceProblem = 'notFound' | 'priceZero' | 'bulkAbove';
/** Worth a second look, but allowed. */
export type PriceWarning = 'belowCost' | 'wholesaleAboveShelf' | 'bigChange';

type Move<T> = { from: T; to: T };

/** A change as it would be saved: each price before and after, with what is wrong or odd about it. */
export interface PlannedPriceChange {
  productId: number;
  name: string;
  categoryName: string;
  cost: Move<number | null>;
  wholesalePrice: Move<number | null>;
  price: Move<number>;
  /** The mark-up on cost after the change, for the shelf and the wholesale price. */
  markup: { price: number | null; wholesale: number | null };
  lowestBulkPrice: number | null;
  problems: PriceProblem[];
  warnings: PriceWarning[];
}

export interface PricePlan {
  changes: PlannedPriceChange[];
  /** Rows that asked for the prices products already have. */
  unchanged: number;
}

/** A row of a price file no product matched. */
export interface UnmatchedRow {
  row: number;
  text: string;
}

export interface PriceFilePlan extends PricePlan {
  notFound: UnmatchedRow[];
  /** Rows whose price cells couldn't be read as amounts. */
  unreadable: UnmatchedRow[];
}

export interface FromCostInput {
  /** Which products: these, or every product in a category, or (neither) every product. */
  productIds?: number[];
  categoryId?: number;
  level: 'shelf' | 'wholesale';
  markupPercent: number;
  rounding: 'exact' | 'nice';
}

export type PriceSource = 'editor' | 'excel' | 'fromCost';

const MAX_CHANGES = 5_000;
const BIG_CHANGE = 0.5;
const money = (value: string | null) => (value === null ? null : Number(value));

/**
 * One way to change many prices: typed on the Prices page, worked out from
 * cost, or read from an Excel file. Each one is planned (checked, nothing
 * saved) and then saved the same way, with a history entry per product.
 */
export class PriceService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly rows: () => Promise<PriceRow[]>,
  ) {}

  async list(): Promise<PriceRowDto[]> {
    return (await this.rows()).map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      otherBarcodes: row.other_barcodes,
      categoryId: row.category_id,
      categoryName: row.category_name,
      unit: row.unit,
      vatRate: row.vat_rate,
      isActive: row.is_active,
      cost: money(row.cost_price),
      wholesalePrice: money(row.wholesale_price),
      price: Number(row.base_price),
      lowestBulkPrice: money(row.lowest_bulk_price),
    }));
  }

  async plan(changes: PriceChangeInput[]): Promise<PricePlan> {
    return planChanges(changes, await this.rows());
  }

  /** New shelf or wholesale prices from each product's cost; products with no cost are left out. */
  async fromCost(input: FromCostInput): Promise<PricePlan & { noCost: number }> {
    const ids = input.productIds && new Set(input.productIds);
    const chosen = (await this.rows()).filter(
      (row) => (ids ? ids.has(row.id) : input.categoryId === undefined || row.category_id === input.categoryId),
    );
    const withCost = chosen.filter((row) => row.cost_price !== null && Number(row.cost_price) > 0);
    const changes = withCost.map((row) => {
      const next = priceFromCost(Number(row.cost_price), input.markupPercent, input.rounding);
      return input.level === 'shelf' ? { productId: row.id, price: next } : { productId: row.id, wholesalePrice: next };
    });
    return { ...planChanges(changes, chosen), noCost: chosen.length - withCost.length };
  }

  /** Reads a price file (the one 4VD downloads, or one in the same shape) and plans its changes. */
  async readFile(fileName: string, base64: string): Promise<PriceFilePlan> {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0) throw new ValidationError('The file is empty');
    if (bytes.length > 10 * 1024 * 1024) throw new ValidationError('The file is over 10 MB');
    let cells: Cell[][];
    try {
      cells = /\.csv$/i.test(fileName) ? readCsv(bytes) : await readXlsx(bytes);
    } catch {
      throw new ValidationError('The file couldn’t be opened. Is it really an Excel or CSV file?');
    }
    const rows = await this.rows();
    const { changes, notFound, unreadable } = readPriceFile(cells, rows);
    return { ...planChanges(changes, rows), notFound, unreadable };
  }

  /** Saves the changes, all or none: refused when any of them has a problem. */
  async apply(changes: PriceChangeInput[], source: PriceSource, actorId: number): Promise<{ changed: number }> {
    if (changes.length > MAX_CHANGES) throw new ValidationError(`At most ${MAX_CHANGES} products at once`);
    return this.transactions.run(async (repos) => {
      const rows = await repos.products.priceRows();
      const { changes: planned } = planChanges(changes, rows);
      const blocked = planned.filter((change) => change.problems.length > 0);
      if (blocked.length > 0) {
        throw new ValidationError(`${blocked.length} of these can’t be saved: ${blocked.slice(0, 3).map((change) => change.name || `#${change.productId}`).join(', ')}`);
      }
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const change of planned) await saveChange(repos, byId.get(change.productId)!, change, source, actorId);
      return { changed: planned.length };
    });
  }
}

async function saveChange(repos: TransactionalRepositories, row: PriceRow, change: PlannedPriceChange, source: PriceSource, actorId: number): Promise<void> {
  await repos.products.setPrices(row.id, {
    ...(change.price.from !== change.price.to && { basePrice: change.price.to }),
    ...(change.wholesalePrice.from !== change.wholesalePrice.to && { wholesalePrice: change.wholesalePrice.to }),
    ...(change.cost.from !== change.cost.to && { costPrice: change.cost.to }),
  });
  const same = { name: row.name, description: null, categoryId: row.category_id, imageUrl: null, sku: row.sku, isActive: row.is_active, vatRate: row.vat_rate, vatExempt: false, originCountry: null };
  const before: ProductSnapshot = { ...same, price: change.price.from, costPrice: change.cost.from, wholesalePrice: change.wholesalePrice.from };
  const after: ProductSnapshot = { ...same, price: change.price.to, costPrice: change.cost.to, wholesalePrice: change.wholesalePrice.to };
  const described = describeProductChanges(before, after);
  if (!described) return;
  await repos.activityLog.create({
    userId: actorId,
    action: 'product.updated',
    entityType: 'product',
    entityId: row.id,
    say: described.say,
    details: { ...described.details, source },
  });
}

/** Checks each change against the products as they are; changes that change nothing are only counted. */
export function planChanges(changes: PriceChangeInput[], rows: PriceRow[]): PricePlan {
  const byId = new Map(rows.map((row) => [row.id, row]));
  // The same product twice: the later row wins, as it would in a spreadsheet.
  const merged = new Map<number, PriceChangeInput>();
  for (const change of changes) merged.set(change.productId, { ...merged.get(change.productId), ...change });
  const planned: PlannedPriceChange[] = [];
  let unchanged = 0;
  for (const change of merged.values()) {
    const row = byId.get(change.productId);
    if (!row) {
      planned.push(missing(change.productId));
      continue;
    }
    const cost = { from: money(row.cost_price), to: change.costPrice === undefined ? money(row.cost_price) : roundOrNull(change.costPrice) };
    const wholesalePrice = { from: money(row.wholesale_price), to: change.wholesalePrice === undefined ? money(row.wholesale_price) : roundOrNull(change.wholesalePrice) };
    const price = { from: Number(row.base_price), to: change.price === undefined ? Number(row.base_price) : roundMoney(change.price) };
    if (cost.from === cost.to && wholesalePrice.from === wholesalePrice.to && price.from === price.to) {
      unchanged++;
      continue;
    }
    const lowestBulkPrice = money(row.lowest_bulk_price);
    const problems: PriceProblem[] = [];
    if (price.to <= 0) problems.push('priceZero');
    if (price.to !== price.from && lowestBulkPrice !== null && price.to <= lowestBulkPrice) problems.push('bulkAbove');
    const warnings: PriceWarning[] = [];
    if (cost.to !== null && (price.to < cost.to || (wholesalePrice.to !== null && wholesalePrice.to < cost.to))) warnings.push('belowCost');
    if (wholesalePrice.to !== null && wholesalePrice.to > price.to) warnings.push('wholesaleAboveShelf');
    if (price.from > 0 && Math.abs(price.to - price.from) / price.from > BIG_CHANGE) warnings.push('bigChange');
    planned.push({
      productId: row.id,
      name: row.name,
      categoryName: row.category_name,
      cost,
      wholesalePrice,
      price,
      markup: { price: markupOf(price.to, cost.to), wholesale: wholesalePrice.to === null ? null : markupOf(wholesalePrice.to, cost.to) },
      lowestBulkPrice,
      problems,
      warnings,
    });
  }
  return { changes: planned, unchanged };
}

const roundOrNull = (value: number | null) => (value === null ? null : roundMoney(value));

function missing(productId: number): PlannedPriceChange {
  return {
    productId,
    name: '',
    categoryName: '',
    cost: { from: null, to: null },
    wholesalePrice: { from: null, to: null },
    price: { from: 0, to: 0 },
    markup: { price: null, wholesale: null },
    lowestBulkPrice: null,
    problems: ['notFound'],
    warnings: [],
  };
}

type Column = 'barcode' | 'code' | 'name' | 'price' | 'wholesale' | 'cost';

/** Header words, compared without case or accents: 4VD's own price file, TREFIN's words and plain Albanian. */
const HEADERS: Record<Column, string[]> = {
  barcode: ['barcode', 'barkodi', 'barkod', 'ean'],
  code: ['code', 'kodi', 'sku', 'shifra', 'nr art'],
  name: ['product', 'produkti', 'name', 'emri', 'emertimi', 'artikulli'],
  price: ['shelf price', 'price', 'retail price', 'cmimi', 'cmimi ne raft', 'cmimi me pakice', 'pakice', 'me pakice'],
  wholesale: ['wholesale price', 'wholesale', 'cmimi me shumice', 'shumice', 'me shumice'],
  cost: ['cost', 'cost price', 'kosto', 'kostoja', 'cmimi i kostos', 'cmimi i blerjes'],
};

const cellText = (cell: Cell | undefined) => (cell === null || cell === undefined ? '' : cell instanceof Date ? '' : String(cell).trim());

/**
 * Finds the header row (within the first 20), then matches each row to a
 * product by barcode (any of its barcodes), then code, then exact name. An
 * empty price cell leaves that price as it is.
 */
export function readPriceFile(cells: Cell[][], rows: PriceRow[]): { changes: PriceChangeInput[]; notFound: UnmatchedRow[]; unreadable: UnmatchedRow[] } {
  let header = -1;
  const at: Partial<Record<Column, number>> = {};
  for (let index = 0; index < Math.min(cells.length, 20) && header < 0; index++) {
    const found: Partial<Record<Column, number>> = {};
    cells[index]!.forEach((cell, column) => {
      const text = normalise(cellText(cell));
      for (const [key, words] of Object.entries(HEADERS) as Array<[Column, string[]]>) {
        if (found[key] === undefined && words.includes(text)) found[key] = column;
      }
    });
    const findsProduct = found.barcode !== undefined || found.code !== undefined || found.name !== undefined;
    const hasPrice = found.price !== undefined || found.wholesale !== undefined || found.cost !== undefined;
    if (findsProduct && hasPrice) {
      header = index;
      Object.assign(at, found);
    }
  }
  if (header < 0) {
    throw new ValidationError('No header row found. The file needs a Barcode, Code or Product column and at least one of Shelf price, Wholesale price or Cost.');
  }

  const byBarcode = new Map<string, number>();
  const byCode = new Map<string, number>();
  const byName = new Map<string, number | null>();
  for (const row of rows) {
    for (const code of [row.barcode, ...row.other_barcodes]) if (code) byBarcode.set(code, row.id);
    if (row.sku) byCode.set(normalise(row.sku), row.id);
    const name = normalise(row.name);
    // Two products with the same name: a name alone can't say which.
    byName.set(name, byName.has(name) ? null : row.id);
  }

  const changes: PriceChangeInput[] = [];
  const notFound: UnmatchedRow[] = [];
  const unreadable: UnmatchedRow[] = [];
  for (let index = header + 1; index < cells.length; index++) {
    const line = cells[index]!;
    const pick = (column: Column) => (at[column] === undefined ? undefined : line[at[column]!]);
    const barcode = cellText(pick('barcode')).replace(/\.0+$/, '');
    const code = normalise(cellText(pick('code')));
    const name = cellText(pick('name'));
    if (!barcode && !code && !name) continue;
    const label = name || barcode || code;
    const productId = (barcode && byBarcode.get(barcode)) || (code && byCode.get(code)) || (name && byName.get(normalise(name))) || undefined;
    if (productId === undefined) {
      notFound.push({ row: index + 1, text: label });
      continue;
    }
    const change: PriceChangeInput = { productId };
    let bad = false;
    for (const [column, field] of [
      ['price', 'price'],
      ['wholesale', 'wholesalePrice'],
      ['cost', 'costPrice'],
    ] as const) {
      const cell = pick(column);
      if (cellText(cell) === '') continue;
      const amount = parseMoney(cell ?? null);
      if (amount === null || amount < 0) bad = true;
      else change[field] = amount;
    }
    if (bad) unreadable.push({ row: index + 1, text: label });
    else changes.push(change);
  }
  return { changes, notFound, unreadable };
}
