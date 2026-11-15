import { sql } from 'kysely';
import type { AccountLinkKey } from '../constants/chartOfAccounts.js';
import type { DatabaseClient } from '../database/connection.js';
import type { AssetCategory, AssetDisposal } from '../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import { type AssetRow, assetColumns } from '../repositories/AssetRepository.js';
import type { TransactionalRepositories, TransactionManager } from '../repositories/TransactionManager.js';
import { roundMoney } from '../utils/money.js';
import { zonedDay } from '../utils/zonedDates.js';
import {
  addMonths,
  type AssetBasis,
  DEFAULT_RATES,
  depreciable,
  firstMonth,
  lastFinishedMonth,
  monthlyAmount,
  monthStart,
  projection,
  SMALL_ASSET_LIMIT,
} from './assets/depreciation.js';
import { BOOKS_START_KEY } from './books/BooksPoster.js';
import { vatOf } from './books/entryBuilder.js';
import { assertMonthsOpen, YearClosedError } from './vat/periodLock.js';

export const ASSET_CATEGORIES: AssetCategory[] = ['furniture', 'equipment', 'vehicle', 'building', 'land', 'intangible', 'other'];

export type AssetStatus = 'in_use' | 'worn_out' | 'sold' | 'scrapped' | 'returned';

export interface AssetDto {
  id: number;
  name: string;
  code: string | null;
  category: AssetCategory;
  boughtOn: string;
  inUseFrom: string;
  cost: number;
  residual: number;
  rate: number;
  /** A full month's depreciation at the rate. */
  monthly: number;
  /** Worn before the books started, typed in. */
  openingDepreciated: number;
  /** Worn so far: before the books plus every stored month. */
  depreciated: number;
  /** What it is worth on the books now: cost less depreciation so far. */
  value: number;
  /** The last month worked out, if any. */
  lastMonth: string | null;
  /** The month it will be worn out, as things stand; null for land or a rate of 0. */
  wornOutIn: string | null;
  status: AssetStatus;
  place: 'shop' | 'carwash';
  note: string | null;
  /** Under the small-asset limit: the tax rules may let it be a cost at once. */
  small: boolean;
  bill: { id: number; number: string | null; supplier: string | null } | null;
  disposal: {
    kind: AssetDisposal;
    day: string;
    /** Without VAT, its VAT and the rate; null unless sold. */
    net: number | null;
    vat: number | null;
    vatRate: number | null;
    buyer: string | null;
    buyerNui: string | null;
    customerId: number | null;
    paidPlaceId: number | null;
    creditBill: { id: number; number: string | null } | null;
    /** Sale price (without VAT) plus depreciation, less cost: a gain above 0, a loss below. */
    result: number;
    note: string | null;
  } | null;
}

export interface AssetDetailDto extends AssetDto {
  /** Each worked-out month, oldest first. */
  months: Array<{ month: string; amount: number }>;
  /** The months still to come, as things stand. */
  plan: Array<{ month: string; amount: number }>;
  /** Whether its kind, start or cost can still change (no month worked out yet). */
  canChangeStart: boolean;
}

export interface NewAssetInput {
  name: string;
  code: string | null;
  category: AssetCategory;
  boughtOn: string;
  inUseFrom: string;
  cost: number;
  residual: number;
  rate: number | null;
  /** Null: worked out from the rate up to the books' first day. */
  openingDepreciated: number | null;
  place: 'shop' | 'carwash';
  note: string | null;
}

export type AssetChangesInput = Partial<Omit<NewAssetInput, 'place' | 'openingDepreciated'>> & { openingDepreciated?: number };

export interface DisposeInput {
  kind: 'sold' | 'scrapped';
  day: string;
  /** What the buyer pays, VAT included. */
  amount: number | null;
  vatRate: 0 | 8 | 18 | null;
  buyerName: string | null;
  buyerNui: string | null;
  customerId: number | null;
  paidPlaceId: number | null;
  note: string | null;
}

export interface ScheduleRow {
  id: number;
  name: string;
  code: string | null;
  category: AssetCategory;
  inUseFrom: string;
  rate: number;
  cost: number;
  /** Depreciation before the year. */
  openingDepreciated: number;
  /** Depreciation in the year. */
  depreciation: number;
  /** What it was worth at the start of the year (0 if bought in it). */
  openingValue: number;
  /** Bought in the year. */
  added: number;
  /** Its value when it left, if it left in the year. */
  disposedValue: number;
  /** Worth at the year's end (0 if it left). */
  closingValue: number;
  disposal: AssetDisposal | null;
  disposedOn: string | null;
  result: number | null;
}

export interface BooksCheckRow {
  category: AssetCategory;
  /** The register's cost and depreciation so far for assets still owned. */
  cost: number;
  depreciated: number;
  /** What the books' accounts hold. */
  booksCost: number;
  booksDepreciated: number;
  costAccount: string;
  depreciationAccount: string | null;
}

/**
 * The fixed assets register: what the business owns, what it cost and how it
 * wears out. Months of depreciation are worked out by the books (see
 * assets/depreciation.ts); this keeps the register, takes assets in and out
 * and reads it for the pages and the downloads.
 */
export class FixedAssetService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly transactions: TransactionManager,
    private readonly timeZone: string,
    /** Brings the books (and the months of depreciation due) up to date before reading. */
    private readonly syncBooks: () => Promise<void>,
  ) {}

  private today(now = new Date()) {
    return zonedDay(now, this.timeZone);
  }

  async list(now = new Date()): Promise<AssetDto[]> {
    await this.syncBooks();
    const rows = await assetColumns(this.db).where('a.voided_at', 'is', null).orderBy('a.in_use_from', 'desc').orderBy('a.id', 'desc').execute();
    return rows.map((row) => toDto(row, now, this.timeZone));
  }

  async get(id: number, now = new Date()): Promise<AssetDetailDto> {
    await this.syncBooks();
    const row = await assetColumns(this.db).where('a.id', '=', id).executeTakeFirst();
    if (!row || row.voided_at) throw new NotFoundError(`Asset ${id} does not exist`);
    const months = await this.transactions.run((repos) => repos.assets.months(id));
    const dto = toDto(row, now, this.timeZone);
    const after = row.last_month ?? lastFinishedMonth(now, this.timeZone);
    return {
      ...dto,
      months,
      plan: dto.disposal ? [] : projection(basis(row), dto.depreciated, after < lastFinishedMonth(now, this.timeZone) ? lastFinishedMonth(now, this.timeZone) : after),
      canChangeStart: months.length === 0 && !dto.disposal,
    };
  }

  /** What an asset typed in as already owned had worn before the books started, at its rate. */
  async suggestedOpening(input: Pick<NewAssetInput, 'category' | 'cost' | 'residual' | 'rate' | 'inUseFrom'>): Promise<number> {
    const start = await this.booksStart();
    if (!start) return 0;
    const asset: AssetBasis = { category: input.category, cost: input.cost, residual: input.residual, rate: input.rate ?? DEFAULT_RATES[input.category], openingDepreciated: 0, inUseFrom: input.inUseFrom, disposedOn: null };
    const monthly = monthlyAmount(asset);
    let months = 0;
    for (let month = firstMonth(asset); month < monthStart(start); month = addMonths(month, 1)) months += 1;
    return Math.min(roundMoney(monthly * months), depreciable(asset));
  }

  private async booksStart(): Promise<string | null> {
    const row = await this.db.selectFrom('settings').select('value').where('key', '=', BOOKS_START_KEY).executeTakeFirst();
    return typeof row?.value === 'string' ? row.value : null;
  }

  /** An asset already owned: its cost and wear so far are in the opening balances, so it posts only its months to come. */
  async create(input: NewAssetInput, actorId: number, now = new Date()): Promise<AssetDetailDto> {
    checkDates(input.boughtOn, input.inUseFrom, this.today(now));
    const rate = input.rate ?? DEFAULT_RATES[input.category];
    checkFigures(input.category, input.cost, input.residual, rate);
    const opening = input.openingDepreciated ?? (await this.suggestedOpening({ ...input, rate }));
    if (opening > roundMoney(input.cost - input.residual)) throw new ValidationError('openingDepreciated: it can’t have worn more than its cost less what it is still worth at the end');
    const id = await this.transactions.run(async (repos) => {
      const assetId = await repos.assets.create({ ...input, rate, openingDepreciated: opening, billLineId: null, createdBy: actorId });
      await repos.activityLog.create({
        userId: actorId,
        action: 'asset.created',
        entityType: 'asset',
        entityId: assetId,
        say: { key: 'assetAdded', params: { name: input.name, cost: input.cost } },
        details: { ...input, rate, openingDepreciated: opening },
      });
      return assetId;
    });
    return this.get(id, now);
  }

  async update(id: number, input: AssetChangesInput, actorId: number, now = new Date()): Promise<AssetDetailDto> {
    await this.transactions.run(async (repos) => {
      await repos.assets.lock(id);
      const row = await live(repos, id);
      const fromBill = row.bill_line_id !== null;
      const stored = (await repos.assets.months(id)).length > 0;
      const changesBasis = ['category', 'inUseFrom', 'boughtOn', 'cost', 'residual', 'rate', 'openingDepreciated'].some((key) => (input as Record<string, unknown>)[key] !== undefined);
      if (row.disposal && changesBasis) throw new ConflictError('It has left the business. Undo that first to change its figures.');
      if (fromBill && (input.cost !== undefined || input.category !== undefined || input.boughtOn !== undefined || input.openingDepreciated !== undefined)) {
        throw new ConflictError('Its cost, kind and day bought come from its bill. Change the bill (void it, or add a credit) instead.');
      }
      if (stored && (input.category !== undefined || input.inUseFrom !== undefined)) {
        throw new ConflictError('Its depreciation has started, so its kind and the day it went into use can no longer change.');
      }
      const next = {
        category: input.category ?? row.category,
        cost: input.cost ?? Number(row.cost),
        residual: input.residual ?? Number(row.residual),
        rate: input.rate ?? Number(row.rate),
        boughtOn: input.boughtOn ?? row.bought_on,
        inUseFrom: input.inUseFrom ?? row.in_use_from,
        opening: input.openingDepreciated ?? Number(row.opening_depreciated),
      };
      checkDates(next.boughtOn, next.inUseFrom, this.today(now));
      checkFigures(next.category, next.cost, next.residual, next.rate);
      if (next.opening > roundMoney(next.cost - next.residual)) throw new ValidationError('openingDepreciated: it can’t have worn more than its cost less what it is still worth at the end');
      await repos.assets.update(id, { ...input, rate: input.rate ?? undefined });
      await repos.activityLog.create({
        userId: actorId,
        action: 'asset.updated',
        entityType: 'asset',
        entityId: id,
        say: { key: 'assetEdited', params: { name: input.name ?? row.name } },
        details: { from: pickFigures(row), to: input },
      });
    });
    return this.get(id, now);
  }

  /** One bill line for several things (three chairs): equal parts, before its depreciation starts. */
  async split(id: number, pieces: number, actorId: number, now = new Date()): Promise<AssetDto[]> {
    const ids = await this.transactions.run(async (repos) => {
      await repos.assets.lock(id);
      const row = await live(repos, id);
      if (row.disposal) throw new ConflictError('It has left the business, so it can’t be split.');
      if ((await repos.assets.months(id)).length > 0) throw new ConflictError('Its depreciation has started, so it can’t be split any more.');
      const cost = Number(row.cost);
      const part = Math.floor((cost / pieces) * 100) / 100;
      const residualPart = Math.floor((Number(row.residual) / pieces) * 100) / 100;
      if (part <= 0) throw new ValidationError('pieces: each part would cost nothing');
      const last = roundMoney(cost - part * (pieces - 1));
      const lastResidual = roundMoney(Number(row.residual) - residualPart * (pieces - 1));
      await repos.assets.update(id, { cost: part, residual: residualPart });
      const made = [id];
      for (let index = 1; index < pieces; index += 1) {
        const isLast = index === pieces - 1;
        made.push(
          await repos.assets.create({
            name: row.name,
            code: null,
            category: row.category,
            boughtOn: row.bought_on,
            inUseFrom: row.in_use_from,
            cost: isLast ? last : part,
            residual: isLast ? lastResidual : residualPart,
            rate: Number(row.rate),
            openingDepreciated: 0,
            billLineId: row.bill_line_id,
            place: row.place,
            note: row.note,
            createdBy: actorId,
          }),
        );
      }
      await repos.activityLog.create({
        userId: actorId,
        action: 'asset.split',
        entityType: 'asset',
        entityId: id,
        say: { key: 'assetSplit', params: { name: row.name, pieces } },
        details: { ids: made },
      });
      return made;
    });
    const all = await this.list(now);
    return all.filter((asset) => ids.includes(asset.id));
  }

  /** Sold or thrown away: takes it off the books on that day, with its gain or loss. */
  async dispose(id: number, input: DisposeInput, actorId: number, now = new Date()): Promise<AssetDetailDto> {
    if (input.day > this.today(now)) throw new ValidationError('day: it can’t leave on a day that hasn’t happened yet');
    await this.transactions.run(async (repos) => {
      await repos.assets.lock(id);
      const row = await live(repos, id);
      if (row.disposal) throw new ConflictError(`${row.name} has already left the business`);
      if (input.day < row.bought_on) throw new ValidationError('day: it can’t leave before it was bought');
      await assertMonthsOpen(repos.periods, [input.day]);
      // Months after the one it left in are no longer its.
      const from = addMonths(monthStart(input.day), 1);
      const later = (await repos.assets.months(id)).filter((month) => month.month >= from);
      const closed = await repos.periods.closedYearsAmong([...new Set(later.map((month) => Number(month.month.slice(0, 4))))]);
      if (closed.length > 0) throw new YearClosedError(Math.min(...closed));
      await repos.assets.dropMonths(id, from);

      let sale: { net: number; vat: number; rate: number } | null = null;
      if (input.kind === 'sold') {
        if (input.amount === null || input.vatRate === null) throw new ValidationError('amount: say what it was sold for and its VAT rate');
        if (input.paidPlaceId === null && input.customerId === null) throw new ValidationError('paidPlaceId: say where the money went, or which customer owes it');
        const vat = vatOf(input.amount, input.vatRate);
        sale = { net: roundMoney(input.amount - vat), vat, rate: input.vatRate };
      }
      let buyerName = input.buyerName;
      let buyerNui = input.buyerNui;
      if (input.customerId !== null) {
        const customer = await repos.assets.db.selectFrom('customers').select(['name', 'nui']).where('id', '=', input.customerId).executeTakeFirst();
        if (!customer) throw new ValidationError(`customerId: customer ${input.customerId} does not exist`);
        buyerName ??= customer.name;
        buyerNui ??= customer.nui;
      }
      if (input.paidPlaceId !== null) {
        const place = await repos.assets.db.selectFrom('money_places').select('id').where('id', '=', input.paidPlaceId).where('archived_at', 'is', null).executeTakeFirst();
        if (!place) throw new ValidationError(`paidPlaceId: place ${input.paidPlaceId} does not exist`);
      }
      await repos.assets.dispose(id, {
        disposedOn: input.day,
        disposal: input.kind,
        saleNet: sale?.net ?? null,
        saleVatRate: sale?.rate ?? null,
        saleVat: sale?.vat ?? null,
        buyerName: input.kind === 'sold' ? buyerName : null,
        buyerNui: input.kind === 'sold' ? buyerNui : null,
        customerId: input.kind === 'sold' ? input.customerId : null,
        paidPlaceId: input.kind === 'sold' ? input.paidPlaceId : null,
        creditBillId: null,
        note: input.note,
      });
      await repos.activityLog.create({
        userId: actorId,
        action: 'asset.disposed',
        entityType: 'asset',
        entityId: id,
        say: input.kind === 'sold' ? { key: 'assetSold', params: { name: row.name, amount: input.amount ?? 0 } } : { key: 'assetScrapped', params: { name: row.name } },
        details: { ...input },
      });
    });
    return this.get(id, now);
  }

  /** Back in use, as if it never left. A return to the supplier is undone by voiding its credit. */
  async undoDisposal(id: number, actorId: number, now = new Date()): Promise<AssetDetailDto> {
    await this.transactions.run(async (repos) => {
      await repos.assets.lock(id);
      const row = await live(repos, id);
      if (!row.disposal || !row.disposed_on) throw new ConflictError(`${row.name} hasn’t left the business`);
      if (row.disposal === 'returned') throw new ConflictError('It went back to the supplier on a credit. Void that credit to bring it back.');
      await assertMonthsOpen(repos.periods, [row.disposed_on]);
      // Its leaving month was worked out early; back in use, it waits for the month to end like the rest.
      await repos.assets.dropMonths(id, addMonths(lastFinishedMonth(now, this.timeZone), 1));
      await repos.assets.undoDisposal(id);
      await repos.activityLog.create({
        userId: actorId,
        action: 'asset.disposal_undone',
        entityType: 'asset',
        entityId: id,
        say: { key: 'assetBack', params: { name: row.name } },
      });
    });
    return this.get(id, now);
  }

  /** Typed in by mistake. One from a bill goes with its bill. */
  async remove(id: number, actorId: number, now = new Date()): Promise<void> {
    await this.transactions.run(async (repos) => {
      await repos.assets.lock(id);
      const row = await live(repos, id);
      if (row.bill_line_id !== null) throw new ConflictError('It came from a bill. Void the bill (or add a credit) to take it out.');
      if (row.disposal) throw new ConflictError('It has left the business. Undo that first.');
      const months = await repos.assets.months(id);
      const closed = await repos.periods.closedYearsAmong([...new Set(months.map((month) => Number(month.month.slice(0, 4))))]);
      if (closed.length > 0) throw new YearClosedError(Math.min(...closed));
      await repos.assets.dropMonths(id);
      await repos.assets.markVoided(id, actorId, now);
      await repos.activityLog.create({
        userId: actorId,
        action: 'asset.voided',
        entityType: 'asset',
        entityId: id,
        say: { key: 'assetRemoved', params: { name: row.name } },
      });
    });
  }

  /** The year's schedule: each asset owned at some point in it, with its value at the start, its depreciation and its value at the end. */
  async schedule(year: number): Promise<ScheduleRow[]> {
    await this.syncBooks();
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const rows = await assetColumns(this.db)
      .where('a.voided_at', 'is', null)
      .where('a.bought_on', '<=', to)
      .where((eb) => eb.or([eb('a.disposed_on', 'is', null), eb('a.disposed_on', '>=', from)]))
      .orderBy('a.category')
      .orderBy('a.in_use_from')
      .orderBy('a.id')
      .execute();
    if (rows.length === 0) return [];
    const sums = await this.db
      .selectFrom('depreciation_lines as l')
      .innerJoin('depreciation_months as m', 'm.id', 'l.month_id')
      .select([
        'l.asset_id',
        sql<string>`coalesce(sum(l.amount) filter (where m.month < ${from}::date), 0)::text`.as('before'),
        sql<string>`coalesce(sum(l.amount) filter (where m.month between ${from}::date and ${to}::date), 0)::text`.as('during'),
      ])
      .where(
        'l.asset_id',
        'in',
        rows.map((row) => row.id),
      )
      .groupBy('l.asset_id')
      .execute();
    const byAsset = new Map(sums.map((sum) => [sum.asset_id, { before: Number(sum.before), during: Number(sum.during) }]));
    return rows.map((row) => {
      const sum = byAsset.get(row.id) ?? { before: 0, during: 0 };
      const cost = Number(row.cost);
      const before = roundMoney(Number(row.opening_depreciated) + sum.before);
      const boughtInYear = row.bought_on >= from;
      const openingValue = boughtInYear ? 0 : roundMoney(cost - before);
      const leftInYear = row.disposed_on !== null && row.disposed_on <= to;
      const valueAtEnd = roundMoney(cost - before - sum.during);
      return {
        id: row.id,
        name: row.name,
        code: row.code,
        category: row.category,
        inUseFrom: row.in_use_from,
        rate: Number(row.rate),
        cost,
        openingDepreciated: boughtInYear ? 0 : before,
        depreciation: sum.during,
        openingValue,
        added: boughtInYear ? roundMoney(cost - Number(row.opening_depreciated)) : 0,
        disposedValue: leftInYear ? valueAtEnd : 0,
        closingValue: leftInYear ? 0 : valueAtEnd,
        disposal: leftInYear ? row.disposal : null,
        disposedOn: leftInYear ? row.disposed_on : null,
        result: leftInYear ? disposalResult(row) : null,
      };
    });
  }

  /** The register next to the books: cost and depreciation so far of what is still owned, by kind, against each account's balance. */
  async booksCheck(): Promise<BooksCheckRow[]> {
    await this.syncBooks();
    const links = new Map((await this.db.selectFrom('ledger_links as k').innerJoin('ledger_accounts as a', 'a.id', 'k.account_id').select(['k.key', 'k.account_id', 'a.number']).execute()).map((link) => [link.key, link]));
    const balances = new Map(
      (
        await this.db
          .selectFrom('ledger_lines')
          .select(['account_id', sql<string>`sum(debit - credit)::text`.as('balance')])
          .groupBy('account_id')
          .execute()
      ).map((row) => [row.account_id, Number(row.balance)]),
    );
    const rows = await assetColumns(this.db).where('a.voided_at', 'is', null).where('a.disposed_on', 'is', null).where('a.place', '=', 'shop').execute();
    return ASSET_CATEGORIES.map((category) => {
      const own = rows.filter((row) => row.category === category);
      const costLink = links.get(`asset:${category}` as AccountLinkKey);
      const wornLink = category === 'land' ? undefined : links.get(`accumulated:${category}`);
      return {
        category,
        cost: roundMoney(own.reduce((sum, row) => sum + Number(row.cost), 0)),
        depreciated: roundMoney(own.reduce((sum, row) => sum + Number(row.opening_depreciated) + Number(row.posted), 0)),
        booksCost: roundMoney(costLink ? (balances.get(costLink.account_id) ?? 0) : 0),
        booksDepreciated: roundMoney(wornLink ? -(balances.get(wornLink.account_id) ?? 0) : 0),
        costAccount: costLink?.number ?? '',
        depreciationAccount: wornLink?.number ?? null,
      };
    }).filter((row) => row.cost !== 0 || row.depreciated !== 0 || row.booksCost !== 0 || row.booksDepreciated !== 0);
  }
}

async function live(repos: TransactionalRepositories, id: number): Promise<AssetRow> {
  const row = await repos.assets.find(id);
  if (!row || row.voided_at) throw new NotFoundError(`Asset ${id} does not exist`);
  return row;
}

function checkDates(boughtOn: string, inUseFrom: string, today: string) {
  if (boughtOn > today) throw new ValidationError('boughtOn: it can’t be bought on a day that hasn’t happened yet');
  if (inUseFrom < boughtOn) throw new ValidationError('inUseFrom: it can’t go into use before it was bought');
}

function checkFigures(category: AssetCategory, cost: number, residual: number, rate: number) {
  if (residual >= cost) throw new ValidationError('residual: what it is still worth at the end must be less than its cost');
  if (category === 'land' && rate !== 0) throw new ValidationError('rate: land doesn’t wear out, so its rate is 0');
}

const pickFigures = (row: AssetRow) => ({ name: row.name, category: row.category, inUseFrom: row.in_use_from, cost: Number(row.cost), residual: Number(row.residual), rate: Number(row.rate), openingDepreciated: Number(row.opening_depreciated) });

const basis = (row: AssetRow): AssetBasis => ({
  category: row.category,
  cost: Number(row.cost),
  residual: Number(row.residual),
  rate: Number(row.rate),
  openingDepreciated: Number(row.opening_depreciated),
  inUseFrom: row.in_use_from,
  disposedOn: row.disposed_on,
});

function disposalResult(row: AssetRow): number {
  const worn = roundMoney(Number(row.opening_depreciated) + Number(row.posted));
  if (row.disposal === 'returned') return 0;
  return roundMoney(Number(row.sale_net ?? 0) + worn - Number(row.cost));
}

export function toDto(row: AssetRow, now: Date, timeZone: string): AssetDto {
  const asset = basis(row);
  const depreciated = roundMoney(asset.openingDepreciated + Number(row.posted));
  const left = roundMoney(depreciable(asset) - depreciated);
  const monthly = monthlyAmount(asset);
  let wornOutIn: string | null = null;
  if (monthly > 0) {
    if (left <= 0) wornOutIn = row.last_month;
    else {
      const after = row.last_month && row.last_month > lastFinishedMonth(now, timeZone) ? row.last_month : lastFinishedMonth(now, timeZone);
      const months = Math.ceil(left / monthly);
      const start = addMonths(after, 1) < firstMonth(asset) ? firstMonth(asset) : addMonths(after, 1);
      wornOutIn = addMonths(start, months - 1);
    }
  }
  const status: AssetStatus = row.disposal ?? (monthly > 0 && left <= 0 ? 'worn_out' : 'in_use');
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    category: row.category,
    boughtOn: row.bought_on,
    inUseFrom: row.in_use_from,
    cost: asset.cost,
    residual: asset.residual,
    rate: asset.rate,
    monthly,
    openingDepreciated: asset.openingDepreciated,
    depreciated,
    value: roundMoney(asset.cost - depreciated),
    lastMonth: row.last_month,
    wornOutIn: row.disposal ? null : wornOutIn,
    status,
    place: row.place,
    note: row.note,
    small: asset.cost < SMALL_ASSET_LIMIT,
    bill: row.bill_id === null ? null : { id: row.bill_id, number: row.bill_number, supplier: row.supplier_name },
    disposal:
      row.disposal && row.disposed_on
        ? {
            kind: row.disposal,
            day: row.disposed_on,
            net: row.sale_net === null ? null : Number(row.sale_net),
            vat: row.sale_vat === null ? null : Number(row.sale_vat),
            vatRate: row.sale_vat_rate,
            buyer: row.buyer_name ?? row.customer_name,
            buyerNui: row.buyer_nui,
            customerId: row.customer_id,
            paidPlaceId: row.paid_place_id,
            creditBill: row.credit_bill_id === null ? null : { id: row.credit_bill_id, number: row.credit_bill_number },
            result: disposalResult(row),
            note: row.disposal_note,
          }
        : null,
  };
}
