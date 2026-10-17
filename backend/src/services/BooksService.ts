import { sql } from 'kysely';
import {
  ACCOUNT_LINK_KEYS,
  type AccountClass,
  type AccountLinkKey,
  type CashFlowActivity,
  DEBIT_CLASSES,
} from '../constants/chartOfAccounts.js';
import type { DatabaseClient } from '../database/connection.js';
import { NotFoundError, ValidationError } from '../errors/httpErrors.js';
import { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import { type AccountRecord, BooksRepository, type CardLineRecord, type EntryRecord, type LineRecord } from '../repositories/BooksRepository.js';
import { formatEuro, roundMoney } from '../utils/money.js';
import { BOOKS_START_KEY, BooksPoster, insertLines, reverseEntry } from './books/BooksPoster.js';
import { checkoutKeySql } from './books/postingRules.js';
import { VatMonthRepository } from '../repositories/VatMonthRepository.js';
import { assertMonthsOpen } from './vat/periodLock.js';

export interface AccountDto {
  id: number;
  number: string;
  name: string;
  accountClass: AccountClass;
  type: string;
  group: string;
  cashFlow: CashFlowActivity;
  archived: boolean;
  /** On the side the account normally sits: a positive cash or revenue balance is the usual case. */
  balance: number;
  used: boolean;
  /** The kinds of movement that post here by default. */
  links: AccountLinkKey[];
}

export interface EntryLineDto {
  accountId: number;
  accountNumber: string;
  accountName: string;
  debit: number;
  credit: number;
  party: { kind: 'supplier' | 'customer'; id: number; name: string } | null;
  memo: string | null;
}

/** The page a document lives on, so an entry can link to it. */
export interface EntryTarget {
  page: 'document' | 'bill' | 'count' | 'customer' | 'product' | 'expenses' | 'sales';
  id?: number;
  /** For the sales page: what to search for. */
  search?: string;
}

export interface EntryDto {
  id: number;
  date: string;
  kind: 'auto' | 'manual' | 'reversal';
  /** What posted it, e.g. "bill:12"; null for manual entries. */
  source: string | null;
  description: string;
  warning: string | null;
  reversesId: number | null;
  reversed: boolean;
  createdBy: string | null;
  createdAt: string;
  total: number;
  lines: EntryLineDto[];
  target: EntryTarget | null;
}

export interface TrialBalanceRow {
  accountId: number;
  number: string;
  name: string;
  accountClass: AccountClass;
  group: string;
  /** Debits minus credits. */
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

export interface CardLineDto {
  entryId: number;
  date: string;
  kind: EntryDto['kind'];
  source: string | null;
  description: string;
  warning: string | null;
  party: EntryLineDto['party'];
  memo: string | null;
  debit: number;
  credit: number;
  /** Debits minus credits after this line. */
  balance: number;
  correction: boolean;
  target: EntryTarget | null;
}

export interface Period {
  from: string;
  to: string;
}

export interface ManualEntryInput {
  date: string;
  description: string;
  lines: Array<{ accountId: number; debit: number; credit: number; supplierId?: number | null; customerId?: number | null; memo?: string | null }>;
}

export type EntrySource = 'bill' | 'payment' | 'expense' | 'return' | 'write_off' | 'count' | 'document' | 'sale';

/** The balance the way people read it: debit-side accounts as debits minus credits, the others the other way. */
export const naturalBalance = (accountClass: AccountClass, debitMinusCredit: number) =>
  roundMoney(DEBIT_CLASSES.includes(accountClass) ? debitMinusCredit : -debitMinusCredit);

function toLine(line: LineRecord): EntryLineDto {
  return {
    accountId: line.account_id,
    accountNumber: line.account_number,
    accountName: line.account_name,
    debit: Number(line.debit),
    credit: Number(line.credit),
    party:
      line.supplier_id !== null
        ? { kind: 'supplier', id: line.supplier_id, name: line.party_name ?? '' }
        : line.customer_id !== null
          ? { kind: 'customer', id: line.customer_id, name: line.party_name ?? '' }
          : null,
    memo: line.memo,
  };
}

function toEntries(records: EntryRecord[], lines: LineRecord[], targets: Map<string, EntryTarget>): EntryDto[] {
  const byEntry = new Map<number, EntryLineDto[]>();
  for (const line of lines) byEntry.set(line.entry_id, [...(byEntry.get(line.entry_id) ?? []), toLine(line)]);
  return records.map((record) => {
    const entryLines = byEntry.get(record.id) ?? [];
    return {
      id: record.id,
      date: record.entry_date,
      kind: record.kind,
      source: record.source_key,
      description: record.description,
      warning: record.warning,
      reversesId: record.reverses_id,
      reversed: record.reversed_at !== null,
      createdBy: record.created_by_name,
      createdAt: record.created_at.toISOString(),
      total: roundMoney(entryLines.reduce((sum, line) => sum + line.debit, 0)),
      lines: entryLines,
      target: record.source_key ? (targets.get(record.source_key) ?? null) : null,
    };
  });
}

/**
 * The books: the chart of accounts, the entries 4VD posts from every document,
 * entries written by hand, and the views an accountant reads them through.
 * Every read posts whatever is waiting first, so the books are never behind.
 */
export class BooksService {
  private readonly repository: BooksRepository;
  private readonly periods: VatMonthRepository;
  readonly poster: BooksPoster;

  constructor(
    private readonly db: DatabaseClient,
    private readonly timeZone: string,
  ) {
    this.repository = new BooksRepository(db);
    this.periods = new VatMonthRepository(db);
    this.poster = new BooksPoster(db, timeZone);
  }

  async accounts(): Promise<AccountDto[]> {
    await this.poster.sync();
    const [records, links] = await Promise.all([this.repository.accounts(), this.repository.links()]);
    return records.map((record) => this.toAccount(record, links));
  }

  private toAccount(record: AccountRecord, links: Array<{ key: string; account_id: number }>): AccountDto {
    return {
      id: record.id,
      number: record.number,
      name: record.name,
      accountClass: record.class,
      type: record.type_name,
      group: record.group_name,
      cashFlow: record.cash_flow,
      archived: record.archived_at !== null,
      balance: naturalBalance(record.class, Number(record.balance)),
      used: Number(record.lines) > 0,
      links: links.filter((link) => link.account_id === record.id).map((link) => link.key as AccountLinkKey),
    };
  }

  async addAccount(
    input: { number: string; name: string; accountClass: AccountClass; type: string; group: string; cashFlow: CashFlowActivity },
    actorId: number,
  ): Promise<AccountDto> {
    if (await this.repository.findAccountByNumber(input.number)) {
      throw new ValidationError(`Account ${input.number} already exists. Pick a number that isn't used yet.`);
    }
    const id = await this.db.transaction().execute(async (trx) => {
      const accountId = await new BooksRepository(trx).addAccount(input);
      await new ActivityLogRepository(trx).create({
        userId: actorId,
        action: 'books.account_added',
        entityType: 'ledger_account',
        entityId: accountId,
        say: { key: 'bookAccountAdded', params: { number: input.number, name: input.name } },
        details: { ...input },
      });
      return accountId;
    });
    return (await this.accounts()).find((account) => account.id === id)!;
  }

  async updateAccount(
    id: number,
    input: Partial<{ number: string; name: string; accountClass: AccountClass; type: string; group: string; cashFlow: CashFlowActivity; archived: boolean }>,
    actorId: number,
  ): Promise<AccountDto> {
    const account = (await this.accounts()).find((row) => row.id === id);
    if (!account) throw new NotFoundError(`Account ${id} does not exist`);
    const changesNumberOrClass =
      (input.number !== undefined && input.number !== account.number) || (input.accountClass !== undefined && input.accountClass !== account.accountClass);
    if (changesNumberOrClass && account.used) {
      throw new ValidationError(`Account ${account.number} already has entries, so its number and kind stay. Add a new account instead.`);
    }
    if (input.number !== undefined && input.number !== account.number && (await this.repository.findAccountByNumber(input.number))) {
      throw new ValidationError(`Account ${input.number} already exists. Pick a number that isn't used yet.`);
    }
    if (input.archived === true && !account.archived) {
      if (account.links.length > 0) {
        throw new ValidationError(`Account ${account.number} is where 4VD posts some movements. Choose another account for those in the books' settings first.`);
      }
      if (account.balance !== 0) {
        throw new ValidationError(`Account ${account.number} still has a balance of ${formatEuro(account.balance)}. Move it to another account with an entry first.`);
      }
    }
    await this.db.transaction().execute(async (trx) => {
      await new BooksRepository(trx).updateAccount(id, {
        number: input.number,
        name: input.name,
        class: input.accountClass,
        type_name: input.type,
        group_name: input.group,
        cash_flow: input.cashFlow,
        archived_at: input.archived === undefined ? undefined : input.archived ? new Date() : null,
      });
      await new ActivityLogRepository(trx).create({
        userId: actorId,
        action: 'books.account_changed',
        entityType: 'ledger_account',
        entityId: id,
        say: { key: 'bookAccountChanged', params: { number: input.number ?? account.number, name: input.name ?? account.name } },
        details: { before: account, changes: input },
      });
    });
    return (await this.accounts()).find((row) => row.id === id)!;
  }

  async trialBalance(period: Period): Promise<{ rows: TrialBalanceRow[]; warnings: Array<{ warning: string; entries: number; items: number }> }> {
    await this.poster.sync();
    const [accounts, totals, warnings] = await Promise.all([
      this.repository.accounts(),
      this.repository.periodTotals(period.from, period.to),
      this.repository.warnings(period.from, period.to),
    ]);
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const rows = totals
      .map((total): TrialBalanceRow => {
        const account = byId.get(total.account_id)!;
        const opening = Number(total.opening);
        const debit = Number(total.debit);
        const credit = Number(total.credit);
        return {
          accountId: account.id,
          number: account.number,
          name: account.name,
          accountClass: account.class,
          group: account.group_name,
          opening,
          debit,
          credit,
          closing: roundMoney(opening + debit - credit),
        };
      })
      .filter((row) => row.opening !== 0 || row.debit !== 0 || row.credit !== 0)
      .sort((a, b) => a.number.localeCompare(b.number));
    return {
      rows,
      warnings: warnings.map((row) => ({ warning: row.warning, entries: Number(row.entries), items: Number(row.items) })),
    };
  }

  async accountCard(
    id: number,
    period: Period,
    withCorrections: boolean,
  ): Promise<{ account: AccountDto; opening: number; closing: number; debit: number; credit: number; lines: CardLineDto[] }> {
    const account = (await this.accounts()).find((row) => row.id === id);
    if (!account) throw new NotFoundError(`Account ${id} does not exist`);
    const [opening, records] = await Promise.all([
      this.repository.balanceBefore(id, period.from),
      this.repository.cardLines(id, period.from, period.to, withCorrections),
    ]);
    const targets = await this.targetsOf(records.map((record) => record.source_key));
    let running = opening;
    const lines = records.map((record: CardLineRecord): CardLineDto => {
      const line = toLine(record);
      running = roundMoney(running + line.debit - line.credit);
      return {
        entryId: record.entry_id,
        date: record.entry_date,
        kind: record.kind,
        source: record.source_key,
        description: record.description,
        warning: record.warning,
        party: line.party,
        memo: line.memo,
        debit: line.debit,
        credit: line.credit,
        balance: running,
        correction: record.reversed_at !== null || record.kind === 'reversal',
        target: record.source_key ? (targets.get(record.source_key) ?? null) : null,
      };
    });
    const debit = roundMoney(lines.reduce((sum, line) => sum + line.debit, 0));
    const credit = roundMoney(lines.reduce((sum, line) => sum + line.credit, 0));
    // Hidden corrections cancel out, so the closing balance is the same either way.
    return { account, opening, closing: roundMoney(opening + debit - credit), debit, credit, lines };
  }

  /** Every line of every account in the period, for the general ledger download. */
  async generalLedger(period: Period): Promise<CardLineRecord[]> {
    await this.poster.sync();
    return this.repository.allLines(period.from, period.to);
  }

  async journal(filters: Period & { search: string | null; withCorrections: boolean; limit: number; offset: number }): Promise<{ entries: EntryDto[]; total: number }> {
    await this.poster.sync();
    const { entries, total } = await this.repository.journal(filters);
    return { entries: await this.withLines(entries), total };
  }

  async entry(id: number): Promise<EntryDto> {
    await this.poster.sync();
    const record = await this.repository.findEntry(id);
    if (!record) throw new NotFoundError(`Entry ${id} does not exist`);
    return (await this.withLines([record]))[0]!;
  }

  /** The entries a document posted, reversals included, oldest first. */
  async entriesFor(source: EntrySource, id: number): Promise<EntryDto[]> {
    await this.poster.sync();
    const keys = await this.sourceKeys(source, id);
    const records = await this.repository.entriesForSources(keys);
    return this.withLines(records);
  }

  private async withLines(records: EntryRecord[]): Promise<EntryDto[]> {
    const [lines, targets] = await Promise.all([
      this.repository.linesOf(records.map((record) => record.id)),
      this.targetsOf(records.map((record) => record.source_key)),
    ]);
    return toEntries(records, lines, targets);
  }

  /** Where each source's document lives, for links from the books. */
  private async targetsOf(sourceKeys: Array<string | null>): Promise<Map<string, EntryTarget>> {
    const targets = new Map<string, EntryTarget>();
    const idsOf = (kind: string) => [...new Set(sourceKeys.filter((key): key is string => key?.startsWith(`${kind}:`) ?? false).map((key) => Number(key.slice(kind.length + 1))))];
    for (const key of new Set(sourceKeys)) {
      if (!key) continue;
      const [kind, ref] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      if (kind === 'checkout' && ref[0] === 'i') targets.set(key, { page: 'document', id: Number(ref.slice(1)) });
      else if (kind === 'checkout' && ref[0] === 'r') targets.set(key, { page: 'sales', search: ref.slice(1, ref.lastIndexOf('@')) });
      else if (kind === 'checkout') targets.set(key, { page: 'sales' });
      else if (kind === 'bill') targets.set(key, { page: 'bill', id: Number(ref) });
      else if (kind === 'expense') targets.set(key, { page: 'expenses' });
    }
    const lookups: Array<[string, Promise<Array<{ id: number; target: number | null }>>, EntryTarget['page']]> = [];
    const payments = idsOf('payment');
    if (payments.length > 0) lookups.push(['payment', this.db.selectFrom('supplier_payments').select(['id', 'bill_id as target']).where('id', 'in', payments).execute(), 'bill']);
    const countLines = idsOf('count_line');
    if (countLines.length > 0) lookups.push(['count_line', this.db.selectFrom('stock_count_lines').select(['id', 'count_id as target']).where('id', 'in', countLines).execute(), 'count']);
    const adjustments = idsOf('adjustment');
    if (adjustments.length > 0) lookups.push(['adjustment', this.db.selectFrom('stock_adjustments').select(['id', 'product_id as target']).where('id', 'in', adjustments).execute(), 'product']);
    const tabPayments = idsOf('tab_payment');
    if (tabPayments.length > 0) lookups.push(['tab_payment', this.db.selectFrom('tab_entries').select(['id', 'customer_id as target']).where('id', 'in', tabPayments).execute(), 'customer']);
    const writeOffs = idsOf('write_off');
    if (writeOffs.length > 0) lookups.push(['write_off', this.db.selectFrom('write_offs').select(['id', 'product_id as target']).where('id', 'in', writeOffs).execute(), 'product']);
    const returns = idsOf('return');
    if (returns.length > 0) {
      lookups.push([
        'return',
        this.db.selectFrom('document_lines').select(['return_id as id', 'document_id as target']).where('return_id', 'in', returns).execute() as Promise<Array<{ id: number; target: number }>>,
        'document',
      ]);
    }
    for (const [kind, rows, page] of lookups) {
      for (const row of await rows) if (row.target !== null) targets.set(`${kind}:${row.id}`, { page, id: row.target });
    }
    return targets;
  }

  private async sourceKeys(source: EntrySource, id: number): Promise<string[]> {
    switch (source) {
      case 'bill': {
        const payments = await this.db.selectFrom('supplier_payments').select('id').where('bill_id', '=', id).execute();
        return [`bill:${id}`, ...payments.map((payment) => `payment:${payment.id}`)];
      }
      case 'expense': {
        // An expense is a cost line on a bill paid on the spot; from before that, it may have its own old entry.
        const line = await this.db.selectFrom('bill_lines').select('bill_id').where('id', '=', id).executeTakeFirst();
        const keys = line ? await this.sourceKeys('bill', line.bill_id) : [];
        return [`expense:${id}`, ...keys];
      }
      case 'count': {
        const lines = await this.db.selectFrom('stock_count_lines').select('id').where('count_id', '=', id).execute();
        return lines.map((line) => `count_line:${line.id}`);
      }
      case 'document': {
        const document = await this.db.selectFrom('documents').select('kind').where('id', '=', id).executeTakeFirst();
        if (!document) throw new NotFoundError(`Document ${id} does not exist`);
        if (document.kind === 'invoice') return [`checkout:i${id}`];
        const lines = await this.db.selectFrom('document_lines').select('return_id').where('document_id', '=', id).where('return_id', 'is not', null).execute();
        return lines.map((line) => `return:${line.return_id}`);
      }
      case 'sale': {
        const { rows } = await sql<{ key: string }>`select ${checkoutKeySql(this.timeZone)} as key from sales s where s.id = ${id}`.execute(this.db);
        return rows.map((row) => `checkout:${row.key}`);
      }
      default:
        return [`${source}:${id}`];
    }
  }

  async addManualEntry(input: ManualEntryInput, actorId: number): Promise<EntryDto> {
    await assertMonthsOpen(this.periods, [input.date]);
    const start = await this.poster.startDay();
    if (start && input.date < start) {
      throw new ValidationError(`The books start on ${start}. An entry can't be dated before that; balances from before go in the opening entry on ${start}.`);
    }
    const description = input.description.trim();
    if (description === '') throw new ValidationError('Say what the entry is for, so whoever reads the books later knows.');
    if (input.lines.length < 2) throw new ValidationError('An entry needs at least two lines: one account is debited and another credited.');
    input.lines.forEach((line, index) => {
      const sides = (line.debit > 0 ? 1 : 0) + (line.credit > 0 ? 1 : 0);
      if (sides !== 1) throw new ValidationError(`Line ${index + 1}: put an amount in either Debit or Credit, not both and not neither.`);
      if (line.supplierId && line.customerId) throw new ValidationError(`Line ${index + 1}: pick a supplier or a customer, not both.`);
    });
    const debits = roundMoney(input.lines.reduce((sum, line) => sum + line.debit, 0));
    const credits = roundMoney(input.lines.reduce((sum, line) => sum + line.credit, 0));
    if (debits !== credits) {
      const short = roundMoney(Math.abs(debits - credits));
      throw new ValidationError(
        `Debits are ${formatEuro(debits)} and credits ${formatEuro(credits)}; they must be equal. ${formatEuro(short)} is missing on the ${debits > credits ? 'credit' : 'debit'} side.`,
      );
    }
    const accounts = new Map((await this.repository.accounts()).map((account) => [account.id, account]));
    for (const line of input.lines) {
      const account = accounts.get(line.accountId);
      if (!account) throw new ValidationError(`Account ${line.accountId} does not exist.`);
      if (account.archived_at) throw new ValidationError(`Account ${account.number} ${account.name} is archived. Pick another one.`);
    }
    const id = await this.db.transaction().execute(async (trx) => {
      const entryId = await new BooksRepository(trx).addManualEntry({ date: input.date, description, createdBy: actorId });
      await insertLines(
        trx,
        entryId,
        input.lines.map((line) => ({
          accountId: line.accountId,
          debit: roundMoney(line.debit),
          credit: roundMoney(line.credit),
          supplierId: line.supplierId ?? null,
          customerId: line.customerId ?? null,
        })),
        input.lines.map((line) => line.memo?.trim() || null),
      );
      await new ActivityLogRepository(trx).create({
        userId: actorId,
        action: 'books.entry_added',
        entityType: 'ledger_entry',
        entityId: entryId,
        say: { key: 'bookEntryAdded', params: { id: entryId, amount: debits, description } },
        details: { ...input },
      });
      return entryId;
    });
    return this.entry(id);
  }

  /** Cancel an entry written by hand. Entries 4VD wrote change with their document instead. */
  async reverseManualEntry(id: number, actorId: number): Promise<EntryDto> {
    const entry = await this.repository.findEntry(id);
    if (!entry) throw new NotFoundError(`Entry ${id} does not exist`);
    if (entry.kind !== 'manual') {
      throw new ValidationError(
        entry.kind === 'reversal'
          ? 'This entry already cancels another one.'
          : "4VD wrote this entry from a document. Change or undo the document and the books follow; that keeps the two from disagreeing.",
      );
    }
    if (entry.reversed_at) throw new ValidationError(`Entry #${id} is already reversed.`);
    // The reversal is dated like the entry, so it would change that month.
    await assertMonthsOpen(this.periods, [entry.entry_date]);
    const reversalId = await this.db.transaction().execute(async (trx) => {
      const newId = await reverseEntry(trx, id, actorId, null);
      await new ActivityLogRepository(trx).create({
        userId: actorId,
        action: 'books.entry_reversed',
        entityType: 'ledger_entry',
        entityId: id,
        say: { key: 'bookEntryReversed', params: { id } },
      });
      return newId;
    });
    return this.entry(reversalId);
  }

  async settings(): Promise<{ startDay: string | null; links: Array<{ key: AccountLinkKey; accountId: number }> }> {
    const [startDay, links] = await Promise.all([this.poster.startDay(), this.repository.links()]);
    return {
      startDay,
      links: ACCOUNT_LINK_KEYS.map((key) => ({ key, accountId: links.find((link) => link.key === key)?.account_id ?? 0 })),
    };
  }

  async updateSettings(input: { startDay?: string; links?: Partial<Record<AccountLinkKey, number>> }, actorId: number) {
    const before = await this.settings();
    const accounts = new Map((await this.repository.accounts()).map((account) => [account.id, account]));
    for (const [key, accountId] of Object.entries(input.links ?? {})) {
      const account = accounts.get(accountId);
      if (!account) throw new ValidationError(`Account ${accountId} does not exist.`);
      if (account.archived_at) throw new ValidationError(`Account ${account.number} ${account.name} is archived; ${key} can't post to it.`);
    }
    const startChanged = input.startDay !== undefined && input.startDay !== before.startDay;
    const linksChanged = Object.entries(input.links ?? {}).some(([key, accountId]) => before.links.find((link) => link.key === key)?.accountId !== accountId);
    await this.db.transaction().execute(async (trx) => {
      const repository = new BooksRepository(trx);
      const log = new ActivityLogRepository(trx);
      if (linksChanged) {
        for (const [key, accountId] of Object.entries(input.links ?? {})) await repository.setLink(key, accountId);
        await log.create({ userId: actorId, action: 'books.links_changed', entityType: null, entityId: null, say: { key: 'bookLinksChanged' }, details: { before: before.links, after: input.links } });
      }
      if (startChanged) {
        await sql`
          insert into settings (key, value, updated_by, updated_at) values (${BOOKS_START_KEY}, ${JSON.stringify(input.startDay)}, ${actorId}, now())
          on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
        `.execute(trx);
        await log.create({
          userId: actorId,
          action: 'books.start_changed',
          entityType: null,
          entityId: null,
          say: { key: 'booksStartChanged', params: { from: before.startDay, to: input.startDay! } },
        });
      }
    });
    // A new first day changes which documents are in the books: post them all again.
    if (startChanged) await this.poster.rebuild();
    return this.settings();
  }
}
