import { sql } from 'kysely';
import type { DatabaseClient } from '../../database/connection.js';
import { ensurePlaces } from '../../database/places.js';
import type { UserRole } from '../../database/types.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/httpErrors.js';
import { ActivityLogRepository } from '../../repositories/ActivityLogRepository.js';
import { VatMonthRepository } from '../../repositories/VatMonthRepository.js';
import { formatEuro, roundMoney } from '../../utils/money.js';
import { canReopen } from '../../utils/roles.js';
import { zonedDay } from '../../utils/zonedDates.js';
import { type BooksPoster, insertLines, POSTING_LOCK, reverseEntry } from '../books/BooksPoster.js';
import { assertMonthsOpen } from '../vat/periodLock.js';
import { CLOSING_PREFIX, type StatementsService } from './StatementsService.js';

/**
 * 4VD SH.P.K. pays corporate income tax: 10% of the year's profit (Law
 * 06/L-105). Default until the accountant says otherwise (handoff.md): each
 * quarter's instalment is the tax on the profit so far this year, less what
 * earlier quarters paid or still owe; the accountant can type another amount.
 */
export const PROFIT_TAX_RATE = 0.1;
/** Each quarter's instalment is due by the 15th of the month after it. */
export const TM_DUE_DAY = 15;
export const PROFIT_TAX_KEY = 'profit_tax:';
export const TM_KEY = 'tm:';

export type QuarterStatus = 'later' | 'running' | 'due' | 'late' | 'paid' | 'nothing';

export interface InstalmentDto {
  id: number;
  amount: number;
  paidOn: string;
  place: { id: number; kind: 'till' | 'safe' | 'bank'; name: string | null };
  entryId: number | null;
  note: string | null;
  by: string | null;
}

export interface QuarterDto {
  quarter: 1 | 2 | 3 | 4;
  /** First and last day of the quarter. */
  from: string;
  to: string;
  due: string;
  status: QuarterStatus;
  /** Profit before tax from 1 January to the quarter's end (or today, while it runs); null before it starts. */
  profit: number | null;
  /** Tax on that profit. */
  tax: number | null;
  /** What the quarters before paid. */
  paidBefore: number;
  /** What 4VD suggests paying for this quarter. */
  suggested: number | null;
  instalment: InstalmentDto | null;
}

export interface YearDto {
  year: number;
  rate: number;
  /** The books' first day when it falls in this year: profit before it isn't in 4VD. */
  startsInYear: string | null;
  quarters: QuarterDto[];
  paid: number;
  close: {
    closed: { at: string; by: string | null; profit: number; tax: number; taxEntryId: number | null; closeEntryId: number | null } | null;
    /** Why the year can't be closed yet. */
    blockers: Array<'not_over' | 'earlier_open' | 'empty'>;
    earlierOpen: number | null;
    /** VAT months of the year not marked as filed: a warning, not a blocker. */
    unfiledMonths: string[];
    profitBeforeTax: number;
    suggestedTax: number;
    canReopen: boolean;
  };
}

const pad = (value: number) => String(value).padStart(2, '0');
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const quarterRange = (year: number, quarter: number) => ({
  from: `${year}-${pad(quarter * 3 - 2)}-01`,
  to: `${year}-${pad(quarter * 3)}-${pad(lastDay(year, quarter * 3))}`,
});
export const quarterDue = (year: number, quarter: number) => (quarter < 4 ? `${year}-${pad(quarter * 3 + 1)}-${pad(TM_DUE_DAY)}` : `${year + 1}-01-${pad(TM_DUE_DAY)}`);
const taxOn = (profit: number) => (profit > 0 ? roundMoney(profit * PROFIT_TAX_RATE) : 0);
/**
 * A quarter's instalment: the tax on the profit so far, less what earlier
 * quarters paid or still owe (an unpaid quarter stays its own To do, so its
 * share isn't asked for twice).
 */
const instalmentFor = (taxToDate: number, taxBefore: number, paidBefore: number) => Math.max(0, roundMoney(taxToDate - Math.max(taxBefore, paidBefore)));

/**
 * Closing a year and the quarterly profit tax instalments (TM).
 *
 * Paying an instalment debits what is owed on profit tax (2350) from the till,
 * safe or bank. Closing a year posts the year's profit tax (8900 against 2350,
 * so the TM paid comes off it) and then empties every income and cost account
 * into retained earnings (3400), both dated 31 December; the year is then
 * locked like a filed VAT month.
 */
export class YearService {
  private readonly periods: VatMonthRepository;

  constructor(
    private readonly db: DatabaseClient,
    private readonly poster: BooksPoster,
    private readonly statements: StatementsService,
    private readonly timeZone: string,
  ) {
    this.periods = new VatMonthRepository(db);
  }

  private async instalments(year: number | null): Promise<Array<InstalmentDto & { year: number; quarter: number }>> {
    let query = this.db
      .selectFrom('tax_instalments as t')
      .innerJoin('money_places as p', 'p.id', 't.place_id')
      .leftJoin('users as u', 'u.id', 't.created_by')
      .select([
        't.id',
        't.year',
        't.quarter',
        't.amount',
        sql<string>`to_char(t.paid_on, 'YYYY-MM-DD')`.as('paid_on'),
        't.entry_id',
        't.note',
        'p.id as place_id',
        'p.kind as place_kind',
        'p.name as place_name',
        'u.name as by_name',
      ])
      .where('t.undone_at', 'is', null);
    if (year !== null) query = query.where('t.year', '=', year);
    const rows = await query.orderBy('t.quarter').execute();
    return rows.map((row) => ({
      id: row.id,
      year: row.year,
      quarter: row.quarter,
      amount: Number(row.amount),
      paidOn: row.paid_on,
      place: { id: row.place_id, kind: row.place_kind, name: row.place_name },
      entryId: row.entry_id,
      note: row.note,
      by: row.by_name,
    }));
  }

  /** The year's four instalments and whether it can be closed. */
  async year(year: number, actorRole: UserRole, now = new Date()): Promise<YearDto> {
    const today = zonedDay(now, this.timeZone);
    const [startDay, instalments] = await Promise.all([this.poster.startDay(), this.instalments(year)]);
    const quarters: QuarterDto[] = [];
    let paidBefore = 0;
    let taxBefore = 0;
    for (const quarter of [1, 2, 3, 4] as const) {
      const { from, to } = quarterRange(year, quarter);
      const due = quarterDue(year, quarter);
      const instalment = instalments.find((row) => row.quarter === quarter) ?? null;
      const started = today >= from;
      const profit = started ? await this.statements.profitBeforeTax({ from: `${year}-01-01`, to: today < to ? today : to }) : null;
      const tax = profit === null ? null : taxOn(profit);
      const suggested = tax === null ? null : instalmentFor(tax, taxBefore, paidBefore);
      const status: QuarterStatus = instalment
        ? 'paid'
        : !started
          ? 'later'
          : today <= to
            ? 'running'
            : suggested === 0
              ? 'nothing'
              : today <= due
                ? 'due'
                : 'late';
      quarters.push({ quarter, from, to, due, status, profit, tax, paidBefore, suggested, instalment: instalment && { ...instalment } });
      paidBefore = roundMoney(paidBefore + (instalment?.amount ?? 0));
      taxBefore = tax ?? taxBefore;
    }
    return {
      year,
      rate: PROFIT_TAX_RATE,
      startsInYear: startDay && startDay > `${year}-01-01` && startDay <= `${year}-12-31` ? startDay : null,
      quarters,
      paid: paidBefore,
      close: await this.closeView(year, actorRole, today),
    };
  }

  private async closeView(year: number, actorRole: UserRole, today: string): Promise<YearDto['close']> {
    const record = await this.db
      .selectFrom('book_years as y')
      .leftJoin('users as u', 'u.id', 'y.closed_by')
      .select(['y.closed_at', 'u.name as by_name', 'y.profit', 'y.tax', 'y.tax_entry_id', 'y.close_entry_id'])
      .where('y.year', '=', year)
      .executeTakeFirst();
    const [later, earlierOpen, firstYear, filed] = await Promise.all([
      this.db.selectFrom('book_years').select('year').where('year', '>', year).executeTakeFirst(),
      this.earliestOpenBefore(year),
      sql<{ year: number | null }>`select extract(year from min(entry_date))::int as year from ledger_entries`.execute(this.db),
      this.periods.between(`${year}-01-01`, `${year}-12-01`),
    ]);
    const first = firstYear.rows[0]?.year ?? null;
    const blockers: YearDto['close']['blockers'] = [];
    if (today <= `${year}-12-31`) blockers.push('not_over');
    if (earlierOpen !== null) blockers.push('earlier_open');
    if (first === null || first > year) blockers.push('empty');
    const startMonth = Math.max(1, first === year ? Number((await this.poster.startDay())?.slice(5, 7) ?? 1) : 1);
    const lastMonth = today.slice(0, 4) === String(year) ? Number(today.slice(5, 7)) - 1 : 12;
    const filedMonths = new Set(filed.filter((row) => row.filed_at !== null).map((row) => row.month.slice(0, 7)));
    const unfiledMonths: string[] = [];
    if (first !== null && first <= year) {
      for (let month = startMonth; month <= lastMonth; month++) if (!filedMonths.has(`${year}-${pad(month)}`)) unfiledMonths.push(`${year}-${pad(month)}`);
    }
    const profitBeforeTax = record ? Number(record.profit) : await this.statements.profitBeforeTax({ from: `${year}-01-01`, to: `${year}-12-31` });
    return {
      closed: record ? {
        at: record.closed_at.toISOString(),
        by: record.by_name,
        profit: Number(record.profit),
        tax: Number(record.tax),
        taxEntryId: record.tax_entry_id,
        closeEntryId: record.close_entry_id,
      } : null,
      blockers: record ? [] : blockers,
      earlierOpen,
      unfiledMonths: record ? [] : unfiledMonths,
      profitBeforeTax,
      suggestedTax: taxOn(profitBeforeTax),
      canReopen: Boolean(record) && !later && canReopen(actorRole),
    };
  }

  /** The first year before `year` that has entries and isn't closed. */
  private async earliestOpenBefore(year: number): Promise<number | null> {
    const { rows } = await sql<{ year: number }>`
      select distinct extract(year from e.entry_date)::int as year from ledger_entries e
      where e.entry_date < ${`${year}-01-01`}::date
        and not exists (select 1 from book_years y where y.year = extract(year from e.entry_date)::int)
      order by year limit 1
    `.execute(this.db);
    return rows[0]?.year ?? null;
  }

  private async manualEntry(db: DatabaseClient, values: { date: string; sourceKey: string; description: string; by: number }, lines: Parameters<typeof insertLines>[2]): Promise<number> {
    const entry = await db
      .insertInto('ledger_entries')
      .values({ entry_date: values.date, kind: 'manual', source_key: values.sourceKey, description: values.description, created_by: values.by })
      .returning('id')
      .executeTakeFirstOrThrow();
    await insertLines(db, entry.id, lines);
    return entry.id;
  }

  private async linkOf(db: DatabaseClient, key: string): Promise<number> {
    const row = await db.selectFrom('ledger_links').select('account_id').where('key', '=', key).executeTakeFirst();
    if (!row) throw new Error(`The books have no account for: ${key}`);
    return row.account_id;
  }

  /**
   * Close a year: post its profit tax and the closing entry, then lock it.
   * `tax` is what the accountant settles on; it defaults to 10% of the profit.
   */
  async close(year: number, input: { tax?: number }, actor: { id: number; role: UserRole }, now = new Date()): Promise<YearDto> {
    if (!canReopen(actor.role)) throw new ForbiddenError('Only the accountant or the owner can close a year');
    await this.poster.sync();
    const view = await this.closeView(year, actor.role, zonedDay(now, this.timeZone));
    if (view.closed) throw new ConflictError(`${year} is already closed.`);
    if (view.blockers.includes('not_over')) throw new ValidationError(`${year} isn't over yet. A year can be closed from 1 January of the next.`);
    if (view.blockers.includes('earlier_open')) throw new ValidationError(`Close ${view.earlierOpen} first: years close in order.`);
    if (view.blockers.includes('empty')) throw new ValidationError(`The books have nothing in ${year}.`);
    const tax = roundMoney(input.tax ?? view.suggestedTax);
    const day = `${year}-12-31`;

    await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(${POSTING_LOCK})`.execute(trx);
      if (await trx.selectFrom('book_years').select('year').where('year', '=', year).executeTakeFirst()) throw new ConflictError(`${year} is already closed.`);
      let taxEntryId: number | null = null;
      if (tax > 0) {
        taxEntryId = await this.manualEntry(
          trx,
          { date: day, sourceKey: `${PROFIT_TAX_KEY}${year}`, description: `Profit tax for ${year}: ${formatEuro(tax)}`, by: actor.id },
          [
            { accountId: await this.linkOf(trx, 'profit_tax'), debit: tax, credit: 0, supplierId: null, customerId: null },
            { accountId: await this.linkOf(trx, 'profit_tax_payable'), debit: 0, credit: tax, supplierId: null, customerId: null },
          ],
        );
      }
      // Every income and cost account back to zero; what is left over is the year's profit after tax.
      const accounts = await this.statements.profitAccounts(year, trx);
      const net = roundMoney(-accounts.reduce((sum, row) => sum + row.net, 0));
      let closeEntryId: number | null = null;
      if (accounts.length > 0) {
        const lines = accounts.map((row) => ({ accountId: row.accountId, debit: row.net < 0 ? -row.net : 0, credit: row.net > 0 ? row.net : 0, supplierId: null, customerId: null }));
        const retained = await this.linkOf(trx, 'retained_earnings');
        if (net !== 0) lines.push({ accountId: retained, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0, supplierId: null, customerId: null });
        closeEntryId = await this.manualEntry(
          trx,
          { date: day, sourceKey: `${CLOSING_PREFIX}${year}`, description: `Closing ${year}: ${net >= 0 ? 'profit' : 'loss'} of ${formatEuro(Math.abs(net))} moved into retained earnings`, by: actor.id },
          lines,
        );
      }
      await trx
        .insertInto('book_years')
        .values({ year, profit: view.profitBeforeTax, tax, tax_entry_id: taxEntryId, close_entry_id: closeEntryId, closed_by: actor.id })
        .execute();
      await new ActivityLogRepository(trx).create({
        userId: actor.id,
        action: 'books.year_closed',
        entityType: null,
        entityId: null,
        say: { key: 'yearClosed', params: { year, profit: net, tax } },
        details: { year, profitBeforeTax: view.profitBeforeTax, tax, netProfit: net, taxEntryId, closeEntryId, unfiledMonths: view.unfiledMonths },
      });
    });
    return this.year(year, actor.role, now);
  }

  /** Open a closed year again: both its entries are reversed. Only the last closed year, and with a reason. */
  async reopen(year: number, reason: string, actor: { id: number; role: UserRole }, now = new Date()): Promise<YearDto> {
    if (!canReopen(actor.role)) throw new ForbiddenError('Only the accountant or the owner can reopen a year');
    const why = reason.trim();
    if (why.length < 3) throw new ValidationError('Say why the year is being reopened, so the books keep the reason.');
    await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(${POSTING_LOCK})`.execute(trx);
      const record = await trx.selectFrom('book_years').selectAll().where('year', '=', year).executeTakeFirst();
      if (!record) throw new NotFoundError(`${year} isn't closed.`);
      const later = await trx.selectFrom('book_years').select('year').where('year', '>', year).orderBy('year').executeTakeFirst();
      if (later) throw new ValidationError(`Reopen ${later.year} first: years reopen from the newest.`);
      await trx.deleteFrom('book_years').where('year', '=', year).execute();
      for (const id of [record.close_entry_id, record.tax_entry_id]) if (id !== null) await reverseEntry(trx, id, actor.id, null);
      await new ActivityLogRepository(trx).create({
        userId: actor.id,
        action: 'books.year_reopened',
        entityType: null,
        entityId: null,
        say: { key: 'yearReopened', params: { year, reason: why } },
        details: { year, reason: why, profit: Number(record.profit), tax: Number(record.tax) },
      });
    });
    return this.year(year, actor.role, now);
  }

  /** Record a quarter's instalment as paid from a till, the safe or a bank account. */
  async pay(
    year: number,
    quarter: number,
    input: { amount: number; day: string; placeId: number; note?: string | null },
    actor: { id: number; role: UserRole },
    now = new Date(),
  ): Promise<YearDto> {
    const amount = roundMoney(input.amount);
    if (amount <= 0) throw new ValidationError('Type the amount paid.');
    if (input.day > zonedDay(now, this.timeZone)) throw new ValidationError("The day paid can't be in the future.");
    const start = await this.poster.startDay();
    if (start && input.day < start) throw new ValidationError(`The books start on ${start}; a payment from before that belongs in the opening balances.`);
    await assertMonthsOpen(this.periods, [input.day]);
    await this.db.transaction().execute(async (trx) => {
      await ensurePlaces(trx as never);
      const place = await trx.selectFrom('money_places').select(['id', 'account_id', 'carwash_id', 'archived_at']).where('id', '=', input.placeId).executeTakeFirst();
      if (!place || place.archived_at) throw new ValidationError('Pick the till, safe or bank account the money came from.');
      if (place.carwash_id !== null || place.account_id === null) throw new ValidationError("A carwash's till is outside the books; pay from the shop's till, the safe or a bank account.");
      if (await trx.selectFrom('tax_instalments').select('id').where('year', '=', year).where('quarter', '=', quarter).where('undone_at', 'is', null).executeTakeFirst()) {
        throw new ConflictError(`Q${quarter} ${year} is already marked as paid. Take that payment back first to change it.`);
      }
      const note = input.note?.trim() || null;
      const row = await trx
        .insertInto('tax_instalments')
        .values({ year, quarter, amount, paid_on: input.day, place_id: place.id, note, created_by: actor.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      const entryId = await this.manualEntry(
        trx,
        { date: input.day, sourceKey: `${TM_KEY}${row.id}`, description: `Profit tax instalment (TM) for Q${quarter} ${year}`, by: actor.id },
        [
          { accountId: await this.linkOf(trx, 'profit_tax_payable'), debit: amount, credit: 0, supplierId: null, customerId: null },
          { accountId: place.account_id, debit: 0, credit: amount, supplierId: null, customerId: null },
        ],
      );
      await trx.updateTable('tax_instalments').set({ entry_id: entryId }).where('id', '=', row.id).execute();
      await new ActivityLogRepository(trx).create({
        userId: actor.id,
        action: 'books.tm_paid',
        entityType: null,
        entityId: null,
        say: { key: 'tmPaid', params: { year, quarter, amount, day: input.day } },
        details: { instalmentId: row.id, entryId, placeId: place.id, note },
      });
    });
    return this.year(year, actor.role, now);
  }

  /** Take back an instalment recorded by mistake: its entry is reversed. */
  async undo(id: number, actor: { id: number; role: UserRole }, now = new Date()): Promise<YearDto> {
    const row = await this.db
      .selectFrom('tax_instalments')
      .select(['id', 'year', 'quarter', 'amount', 'entry_id', sql<string>`to_char(paid_on, 'YYYY-MM-DD')`.as('paid_on')])
      .where('id', '=', id)
      .where('undone_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw new NotFoundError(`Instalment ${id} doesn't exist or was taken back already.`);
    await assertMonthsOpen(this.periods, [row.paid_on]);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('tax_instalments').set({ undone_at: new Date(), undone_by: actor.id }).where('id', '=', id).execute();
      if (row.entry_id !== null) await reverseEntry(trx, row.entry_id, actor.id, null);
      await new ActivityLogRepository(trx).create({
        userId: actor.id,
        action: 'books.tm_undone',
        entityType: null,
        entityId: null,
        say: { key: 'tmUndone', params: { year: row.year, quarter: row.quarter, amount: Number(row.amount) } },
        details: { instalmentId: id, entryId: row.entry_id },
      });
    });
    return this.year(row.year, actor.role, now);
  }

  /** Quarters over, with tax to pay and nothing paid yet: each is a To do until paid. */
  async dueInstalments(now = new Date()): Promise<Array<{ year: number; quarter: number; due: string; amount: number; late: boolean }>> {
    const today = zonedDay(now, this.timeZone);
    const start = await this.poster.startDay();
    if (!start) return [];
    const thisYear = Number(today.slice(0, 4));
    const out: Array<{ year: number; quarter: number; due: string; amount: number; late: boolean }> = [];
    // This year and last (Q4 is due in January); never before the books start.
    // Only quarters over and unpaid cost a look at the books, so the badge stays quick.
    const [paid, closed] = await Promise.all([
      this.db.selectFrom('tax_instalments').select(['year', 'quarter', 'amount']).where('undone_at', 'is', null).where('year', '>=', thisYear - 1).execute(),
      this.db.selectFrom('book_years').select('year').where('year', '>=', thisYear - 1).execute(),
    ]);
    for (const year of [thisYear - 1, thisYear]) {
      if (`${year}-12-31` < start || closed.some((row) => row.year === year)) continue;
      for (const quarter of [1, 2, 3, 4]) {
        const { to } = quarterRange(year, quarter);
        if (to >= today || to < start || paid.some((row) => row.year === year && row.quarter === quarter)) continue;
        const paidBefore = paid.filter((row) => row.year === year && row.quarter < quarter).reduce((sum, row) => sum + Number(row.amount), 0);
        const taxBefore = quarter === 1 ? 0 : taxOn(await this.statements.profitBeforeTax({ from: `${year}-01-01`, to: quarterRange(year, quarter - 1).to }));
        const amount = instalmentFor(taxOn(await this.statements.profitBeforeTax({ from: `${year}-01-01`, to })), taxBefore, paidBefore);
        const due = quarterDue(year, quarter);
        if (amount > 0) out.push({ year, quarter, due, amount, late: today > due });
      }
    }
    return out;
  }
}
