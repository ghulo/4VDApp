import { sql } from 'kysely';
import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import type { DatabaseClient } from '../database/connection.js';
import type { StockDocumentDirection, StockDocumentReason } from '../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { roundMoney } from '../utils/money.js';
import { zonedDay, zonedDays } from '../utils/zonedDates.js';
import { applyStockChange } from './InventoryService.js';
import type { DateRange } from './reports/calculations.js';
import { formatNumber, readRules } from './shopRules.js';
import { assertMonthsOpen } from './vat/periodLock.js';

/** Why goods come in or go out without a bill or a sale. Damage, loss and expiry are write-offs. */
export const STOCK_DOCUMENT_REASONS: Record<StockDocumentDirection, StockDocumentReason[]> = {
  in: ['found', 'received_free', 'other'],
  out: ['own_use', 'given_away', 'other'],
};

export interface StockDocumentLineDto {
  productId: number;
  productName: string;
  unit: string;
  quantity: number;
  /** What one unit cost when the document was saved; null when the product had no cost. */
  unitCost: number | null;
  /** Quantity × cost; null without a cost. */
  value: number | null;
}

export interface StockDocumentDto {
  id: number;
  number: string;
  direction: StockDocumentDirection;
  reason: StockDocumentReason;
  day: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
  lineCount: number;
  /** The stock's value at cost, from the lines with a cost. */
  value: number;
  /** Lines whose product had no cost, so they add nothing to the value. */
  noCost: number;
  lines?: StockDocumentLineDto[];
}

export interface StockDocumentExportRow {
  day: string;
  number: string;
  direction: StockDocumentDirection;
  reason: StockDocumentReason;
  product: string;
  unit: string;
  quantity: number;
  unit_cost: number | null;
  value: number | null;
  note: string | null;
  voided: boolean;
}

export interface NewStockDocumentInput {
  direction: StockDocumentDirection;
  reason: StockDocumentReason;
  day: string;
  note: string | null;
  /** expiresOn: a best-before date for the units coming in (stock in only). */
  lines: Array<{ productId: number; quantity: number; expiresOn?: string | null }>;
}

const numberKind = (direction: StockDocumentDirection) => (direction === 'in' ? 'stock_in' : 'stock_out');

/**
 * Stock in and stock out documents. Saving one moves the stock of every line
 * (under the system reason "Stock document", which never posts by itself) and
 * the document writes one entry in the books at cost. Voiding puts the stock
 * back and reverses that entry. Both need the document's month to be open.
 */
export class StockDocumentService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  async list(range: DateRange): Promise<StockDocumentDto[]> {
    const { from, to } = zonedDays(range, this.timeZone);
    const rows = await this.query().where('d.day', '>=', from).where('d.day', '<=', to).orderBy('d.day', 'desc').orderBy('d.id', 'desc').execute();
    return rows.map(toDto);
  }

/** Every line of the documents from `from` to `to`, for the Excel download. */
  async linesBetween(from: string, to: string): Promise<StockDocumentExportRow[]> {
    const rows = await this.db
      .selectFrom('stock_document_lines as l')
      .innerJoin('stock_documents as d', 'd.id', 'l.document_id')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .select([
        sql<string>`to_char(d.day, 'YYYY-MM-DD')`.as('day'),
        'd.number',
        'd.direction',
        'd.reason',
        'p.name as product',
        'p.unit',
        'l.quantity',
        'l.unit_cost',
        'd.note',
        'd.voided_at',
      ])
      .where('d.day', '>=', from)
      .where('d.day', '<=', to)
      .orderBy('d.day')
      .orderBy('d.id')
      .orderBy('l.id')
      .execute();
    return rows.map((row) => {
      const unitCost = row.unit_cost === null ? null : Number(row.unit_cost);
      return { ...row, unit_cost: unitCost, value: unitCost === null ? null : roundMoney(row.quantity * unitCost), voided: row.voided_at !== null };
    });
  }

  async get(id: number): Promise<StockDocumentDto> {
    const row = await this.query().where('d.id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundError(`Stock document ${id} does not exist`);
    const lines = await this.db
      .selectFrom('stock_document_lines as l')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .select(['l.product_id', 'p.name', 'p.unit', 'l.quantity', 'l.unit_cost'])
      .where('l.document_id', '=', id)
      .orderBy('l.id')
      .execute();
    return {
      ...toDto(row),
      lines: lines.map((line) => {
        const unitCost = line.unit_cost === null ? null : Number(line.unit_cost);
        return {
          productId: line.product_id,
          productName: line.name,
          unit: line.unit,
          quantity: line.quantity,
          unitCost,
          value: unitCost === null ? null : roundMoney(line.quantity * unitCost),
        };
      }),
    };
  }

  async create(input: NewStockDocumentInput, actorId: number, now = new Date()): Promise<StockDocumentDto> {
    if (!STOCK_DOCUMENT_REASONS[input.direction].includes(input.reason)) {
      throw new ValidationError(`reason: ${input.reason} isn't a reason for stock ${input.direction}`);
    }
    if (input.day > zonedDay(now, this.timeZone)) throw new ValidationError("day: a stock document can't be for a day that hasn't happened yet");
    const productIds = input.lines.map((line) => line.productId);
    if (new Set(productIds).size !== productIds.length) throw new ValidationError('lines: each product goes on one line only');

    const id = await this.transactions.run(async (repos) => {
      await assertMonthsOpen(repos.periods, [input.day]);
      const year = Number(input.day.slice(0, 4));
      const kind = numberKind(input.direction);
      const number = formatNumber((await readRules(repos.settings)).numbering[kind], year, await repos.documents.nextNumber(kind, year));
      const documentId = await repos.stockDocuments.create({ number, direction: input.direction, reason: input.reason, day: input.day, note: input.note, createdBy: actorId });
      for (const line of input.lines) {
        const product = await repos.products.findById(line.productId, true);
        if (!product) throw new ValidationError(`lines: product ${line.productId} does not exist`);
        await repos.stockDocuments.addLine({ documentId, productId: product.id, quantity: line.quantity, unitCost: product.cost_price === null ? null : Number(product.cost_price) });
        await applyStockChange(repos, {
          productId: product.id,
          productName: product.name,
          delta: input.direction === 'in' ? line.quantity : -line.quantity,
          reason: SYSTEM_STOCK_REASONS.STOCK_DOCUMENT,
          notes: number,
          adjustedBy: actorId,
          reorderLevel: product.reorder_level ?? 10,
        });
        const dated = Math.floor(line.quantity);
        if (input.direction === 'in' && line.expiresOn && dated > 0) {
          await repos.expiry.add({ productId: product.id, quantity: dated, expiresOn: line.expiresOn, note: number, orderLineId: null, createdBy: actorId });
        }
      }
      await repos.activityLog.create({
        userId: actorId,
        action: 'stock_document.created',
        entityType: 'stock_document',
        entityId: documentId,
        say: { key: input.direction === 'in' ? 'stockInSaved' : 'stockOutSaved', params: { number, lines: input.lines.length } },
        details: { number, direction: input.direction, reason: input.reason, day: input.day },
      });
      return documentId;
    });
    return this.get(id);
  }

  /** Puts the stock back and reverses the entry. Stock in that has been sold since can't be taken back out. */
  async void(id: number, actorId: number, now = new Date()): Promise<StockDocumentDto> {
    const document = await this.get(id);
    if (document.voidedAt) throw new ConflictError(`${document.number} is already voided`);
    await this.transactions.run(async (repos) => {
      await assertMonthsOpen(repos.periods, [document.day]);
      if (!(await repos.stockDocuments.markVoided(id, actorId, now))) throw new ConflictError(`${document.number} is already voided`);
      for (const line of document.lines ?? []) {
        const product = await repos.products.findById(line.productId, true);
        await applyStockChange(repos, {
          productId: line.productId,
          productName: line.productName,
          delta: document.direction === 'in' ? -line.quantity : line.quantity,
          reason: SYSTEM_STOCK_REASONS.STOCK_DOCUMENT,
          notes: `${document.number} voided`,
          adjustedBy: actorId,
          reorderLevel: product?.reorder_level ?? 10,
        });
      }
      await repos.activityLog.create({
        userId: actorId,
        action: 'stock_document.voided',
        entityType: 'stock_document',
        entityId: id,
        say: { key: 'stockDocumentVoided', params: { number: document.number } },
        details: { number: document.number },
      });
    });
    return this.get(id);
  }

  query() {
    return this.db
      .selectFrom('stock_documents as d')
      .leftJoin('users as c', 'c.id', 'd.created_by')
      .leftJoin('users as v', 'v.id', 'd.voided_by')
      .select([
        'd.id',
        'd.number',
        'd.direction',
        'd.reason',
        sql<string>`to_char(d.day, 'YYYY-MM-DD')`.as('day'),
        'd.note',
        'c.name as created_by_name',
        'd.created_at',
        'd.voided_at',
        'v.name as voided_by_name',
        sql<number>`(select count(*)::int from stock_document_lines l where l.document_id = d.id)`.as('line_count'),
        sql<string>`(select coalesce(sum(round((l.quantity * l.unit_cost)::numeric, 2)), 0)::text from stock_document_lines l where l.document_id = d.id)`.as('value'),
        sql<number>`(select count(*)::int from stock_document_lines l where l.document_id = d.id and l.unit_cost is null)`.as('no_cost'),
      ]);
  }
}

type Row = Awaited<ReturnType<ReturnType<StockDocumentService['query']>['executeTakeFirstOrThrow']>>;

function toDto(row: Row): StockDocumentDto {
  return {
    id: row.id,
    number: row.number,
    direction: row.direction,
    reason: row.reason,
    day: row.day,
    note: row.note,
    createdBy: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    voidedAt: row.voided_at?.toISOString() ?? null,
    voidedBy: row.voided_by_name,
    lineCount: row.line_count,
    value: Number(row.value),
    noCost: row.no_cost,
  };
}
