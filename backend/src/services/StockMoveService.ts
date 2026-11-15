import { sql } from 'kysely';
import { SYSTEM_STOCK_REASONS } from '../constants/stock.js';
import type { DatabaseClient } from '../database/connection.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { zonedDay, zonedDays } from '../utils/zonedDates.js';
import type { DateRange } from './reports/calculations.js';
import { formatNumber, readRules } from './shopRules.js';

export interface StockMoveLineDto {
  productId: number;
  productName: string;
  sku: string | null;
  unit: string;
  quantity: number;
}

export interface StockMoveDto {
  id: number;
  number: string;
  fromId: number;
  from: string;
  toId: number;
  to: string;
  day: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
  lineCount: number;
  /** Units moved, all lines together. */
  units: number;
  lines?: StockMoveLineDto[];
}

export interface StockMoveExportRow {
  day: string;
  number: string;
  from: string;
  to: string;
  product: string;
  unit: string;
  quantity: number;
  note: string | null;
  voided: boolean;
}

export interface NewStockMoveInput {
  fromId: number;
  toId: number;
  day: string;
  note: string | null;
  lines: Array<{ productId: number; quantity: number }>;
}

/**
 * Moving stock between locations (LV-): one step, saved and done. Each line
 * leaves one location and arrives in the other, so the total and the books
 * never change (its stock changes, reason "Moved", don't post). Voiding moves
 * it back. Short-dated batches belong to the product, not a location, so a
 * move leaves them alone.
 */
export class StockMoveService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
  ) {}

  async list(range: DateRange): Promise<StockMoveDto[]> {
    const { from, to } = zonedDays(range, this.timeZone);
    const rows = await this.query().where('m.day', '>=', from).where('m.day', '<=', to).orderBy('m.day', 'desc').orderBy('m.id', 'desc').execute();
    return rows.map(toDto);
  }

  /** Every line of the moves from `from` to `to`, for the Excel download. */
  async linesBetween(from: string, to: string): Promise<StockMoveExportRow[]> {
    const rows = await this.db
      .selectFrom('stock_move_lines as l')
      .innerJoin('stock_moves as m', 'm.id', 'l.move_id')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .innerJoin('stock_locations as f', 'f.id', 'm.from_location_id')
      .innerJoin('stock_locations as t', 't.id', 'm.to_location_id')
      .select([sql<string>`to_char(m.day, 'YYYY-MM-DD')`.as('day'), 'm.number', 'f.name as from', 't.name as to', 'p.name as product', 'p.unit', 'l.quantity', 'm.note', 'm.voided_at'])
      .where('m.day', '>=', from)
      .where('m.day', '<=', to)
      .orderBy('m.day')
      .orderBy('m.id')
      .orderBy('l.id')
      .execute();
    return rows.map(({ voided_at, ...row }) => ({ ...row, voided: voided_at !== null }));
  }

  async get(id: number): Promise<StockMoveDto> {
    const row = await this.query().where('m.id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundError(`Stock move ${id} does not exist`);
    const lines = await this.db
      .selectFrom('stock_move_lines as l')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .select(['l.product_id', 'p.name', 'p.sku', 'p.unit', 'l.quantity'])
      .where('l.move_id', '=', id)
      .orderBy('l.id')
      .execute();
    return {
      ...toDto(row),
      lines: lines.map((line) => ({ productId: line.product_id, productName: line.name, sku: line.sku, unit: line.unit, quantity: line.quantity })),
    };
  }

  async create(input: NewStockMoveInput, actorId: number, now = new Date()): Promise<StockMoveDto> {
    if (input.fromId === input.toId) throw new ValidationError('toId: pick a different location to move to');
    if (input.day > zonedDay(now, this.timeZone)) throw new ValidationError("day: a move can't be for a day that hasn't happened yet");
    const productIds = input.lines.map((line) => line.productId);
    if (new Set(productIds).size !== productIds.length) throw new ValidationError('lines: each product goes on one line only');

    const id = await this.transactions.run(async (repos) => {
      const from = await inUse(repos, input.fromId, 'fromId');
      const to = await inUse(repos, input.toId, 'toId');
      const year = Number(input.day.slice(0, 4));
      const number = formatNumber((await readRules(repos.settings)).numbering.stock_move, year, await repos.documents.nextNumber('stock_move', year));
      const moveId = await repos.locations.createMove({ number, fromId: from.id, toId: to.id, day: input.day, note: input.note, createdBy: actorId });
      for (const line of input.lines) {
        const product = await repos.products.findById(line.productId, true);
        if (!product) throw new ValidationError(`lines: product ${line.productId} does not exist`);
        await repos.locations.addMoveLine(moveId, product.id, line.quantity);
        await move(repos, { productId: product.id, name: product.name, unit: product.unit, quantity: line.quantity, from, to, notes: number, actorId });
      }
      await repos.activityLog.create({
        userId: actorId,
        action: 'stock_move.created',
        entityType: 'stock_move',
        entityId: moveId,
        say: { key: 'stockMoved', params: { number, from: from.name, to: to.name, lines: input.lines.length } },
        details: { number, from: from.id, to: to.id, day: input.day },
      });
      return moveId;
    });
    return this.get(id);
  }

  /** Moves the stock back. What was sold or moved on since can't come back, so that stops it. */
  async void(id: number, actorId: number, now = new Date()): Promise<StockMoveDto> {
    const done = await this.get(id);
    if (done.voidedAt) throw new ConflictError(`${done.number} is already voided`);
    await this.transactions.run(async (repos) => {
      if (!(await repos.locations.voidMove(id, actorId, now))) throw new ConflictError(`${done.number} is already voided`);
      const from = { id: done.toId, name: done.to };
      const to = { id: done.fromId, name: done.from };
      for (const line of done.lines ?? []) {
        await move(repos, { productId: line.productId, name: line.productName, unit: line.unit, quantity: line.quantity, from, to, notes: `${done.number} voided`, actorId });
      }
      await repos.activityLog.create({
        userId: actorId,
        action: 'stock_move.voided',
        entityType: 'stock_move',
        entityId: id,
        say: { key: 'stockMoveVoided', params: { number: done.number } },
        details: { number: done.number },
      });
    });
    return this.get(id);
  }

  query() {
    return this.db
      .selectFrom('stock_moves as m')
      .innerJoin('stock_locations as f', 'f.id', 'm.from_location_id')
      .innerJoin('stock_locations as t', 't.id', 'm.to_location_id')
      .leftJoin('users as c', 'c.id', 'm.created_by')
      .leftJoin('users as v', 'v.id', 'm.voided_by')
      .select([
        'm.id',
        'm.number',
        'm.from_location_id',
        'f.name as from_name',
        'm.to_location_id',
        't.name as to_name',
        sql<string>`to_char(m.day, 'YYYY-MM-DD')`.as('day'),
        'm.note',
        'c.name as created_by_name',
        'm.created_at',
        'm.voided_at',
        'v.name as voided_by_name',
        sql<number>`(select count(*)::int from stock_move_lines l where l.move_id = m.id)`.as('line_count'),
        sql<number>`(select coalesce(sum(l.quantity), 0)::float8 from stock_move_lines l where l.move_id = m.id)`.as('units'),
      ]);
  }
}

/** One line out of one location and into another; the total stays. Two history rows, neither in the books. */
async function move(
  repos: TransactionalRepositories,
  line: { productId: number; name: string; unit: string; quantity: number; from: { id: number; name: string }; to: { id: number; name: string }; notes: string; actorId: number },
): Promise<void> {
  if (!(await repos.inventory.changeAt(line.productId, line.from.id, -line.quantity))) {
    const there = await repos.inventory.quantityAt(line.productId, line.from.id);
    throw new ConflictError(`Only ${there} of ${line.name} at ${line.from.name}, so ${line.quantity} can't move from there`);
  }
  await repos.inventory.changeAt(line.productId, line.to.id, line.quantity);
  const entry = { productId: line.productId, reason: SYSTEM_STOCK_REASONS.MOVE, adjustedBy: line.actorId };
  await repos.stockAdjustments.create({ ...entry, quantity: -line.quantity, notes: `${line.notes} to ${line.to.name}`, locationId: line.from.id });
  await repos.stockAdjustments.create({ ...entry, quantity: line.quantity, notes: `${line.notes} from ${line.from.name}`, locationId: line.to.id });
}

async function inUse(repos: TransactionalRepositories, id: number, field: string) {
  const location = await repos.locations.findById(id);
  if (!location || location.removed_at) throw new ValidationError(`${field}: location ${id} does not exist`);
  return location;
}

type Row = Awaited<ReturnType<ReturnType<StockMoveService['query']>['executeTakeFirstOrThrow']>>;

function toDto(row: Row): StockMoveDto {
  return {
    id: row.id,
    number: row.number,
    fromId: row.from_location_id,
    from: row.from_name,
    toId: row.to_location_id,
    to: row.to_name,
    day: row.day,
    note: row.note,
    createdBy: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    voidedAt: row.voided_at?.toISOString() ?? null,
    voidedBy: row.voided_by_name,
    lineCount: row.line_count,
    units: Number(row.units),
  };
}
