import { sql } from 'kysely';
import type { AccountClass, CashFlowActivity } from '../constants/chartOfAccounts.js';
import type { DatabaseClient } from '../database/connection.js';
import type { LedgerEntryKind } from '../database/types.js';

export interface AccountRecord {
  id: number;
  number: string;
  name: string;
  class: AccountClass;
  type_name: string;
  group_name: string;
  cash_flow: CashFlowActivity;
  archived_at: Date | null;
  /** Debits minus credits over every entry. */
  balance: string;
  lines: string;
}

export interface PeriodTotalsRecord {
  account_id: number;
  /** Debits minus credits before the period. */
  opening: string;
  debit: string;
  credit: string;
}

export interface EntryRecord {
  id: number;
  entry_date: string;
  kind: LedgerEntryKind;
  source_key: string | null;
  description: string;
  warning: string | null;
  reverses_id: number | null;
  reversed_at: Date | null;
  created_by_name: string | null;
  created_at: Date;
}

export interface LineRecord {
  id: number;
  entry_id: number;
  account_id: number;
  account_number: string;
  account_name: string;
  debit: string;
  credit: string;
  supplier_id: number | null;
  customer_id: number | null;
  party_name: string | null;
  memo: string | null;
}

export interface TrefinEntryRecord {
  id: number;
  dated: string;
  kind: string;
  reference: string | null;
  source: string;
}

export interface CardLineRecord extends LineRecord {
  entry_date: string;
  kind: LedgerEntryKind;
  source_key: string | null;
  description: string;
  warning: string | null;
  reverses_id: number | null;
  reversed_at: Date | null;
}

/** Entries that only cancel each other out: a reversed entry and its reversal. */
const correction = sql<boolean>`(e.reversed_at is not null or e.kind = 'reversal')`;
const entryDay = sql<string>`to_char(e.entry_date, 'YYYY-MM-DD')`;

export class BooksRepository {
  constructor(private readonly db: DatabaseClient) {}

  async accounts(): Promise<AccountRecord[]> {
    const { rows } = await sql<AccountRecord>`
      select a.id, a.number, a.name, a.class, a.type_name, a.group_name, a.cash_flow, a.archived_at,
        coalesce(sum(l.debit - l.credit), 0) as balance, count(l.id) as lines
      from ledger_accounts a left join ledger_lines l on l.account_id = a.id
      group by a.id order by a.number
    `.execute(this.db);
    return rows;
  }

  async findAccount(id: number) {
    return this.db.selectFrom('ledger_accounts').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async findAccountByNumber(number: string) {
    return this.db.selectFrom('ledger_accounts').selectAll().where('number', '=', number).executeTakeFirst();
  }

  async accountHasLines(id: number): Promise<boolean> {
    return (await this.db.selectFrom('ledger_lines').select('id').where('account_id', '=', id).limit(1).executeTakeFirst()) !== undefined;
  }

  async addAccount(values: { number: string; name: string; accountClass: AccountClass; type: string; group: string; cashFlow: CashFlowActivity }): Promise<number> {
    const row = await this.db
      .insertInto('ledger_accounts')
      .values({ number: values.number, name: values.name, class: values.accountClass, type_name: values.type, group_name: values.group, cash_flow: values.cashFlow })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async updateAccount(
    id: number,
    values: Partial<{ number: string; name: string; class: AccountClass; type_name: string; group_name: string; cash_flow: CashFlowActivity; archived_at: Date | null }>,
  ): Promise<void> {
    await this.db
      .updateTable('ledger_accounts')
      .set({ ...values, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Per account: the balance before `from`, and debits and credits from `from` to `to` (both days included). */
  async periodTotals(from: string, to: string): Promise<PeriodTotalsRecord[]> {
    const { rows } = await sql<PeriodTotalsRecord>`
      select l.account_id,
        coalesce(sum(l.debit - l.credit) filter (where e.entry_date < ${from}::date), 0) as opening,
        coalesce(sum(l.debit) filter (where e.entry_date between ${from}::date and ${to}::date), 0) as debit,
        coalesce(sum(l.credit) filter (where e.entry_date between ${from}::date and ${to}::date), 0) as credit
      from ledger_lines l join ledger_entries e on e.id = l.entry_id
      where e.entry_date <= ${to}::date
      group by l.account_id
    `.execute(this.db);
    return rows;
  }

  async balanceBefore(accountId: number, from: string): Promise<number> {
    const { rows } = await sql<{ balance: string }>`
      select coalesce(sum(l.debit - l.credit), 0) as balance
      from ledger_lines l join ledger_entries e on e.id = l.entry_id
      where l.account_id = ${accountId} and e.entry_date < ${from}::date
    `.execute(this.db);
    return Number(rows[0]?.balance ?? 0);
  }

  private lineColumns() {
    return sql`l.id, l.entry_id, l.account_id, a.number as account_number, a.name as account_name, l.debit, l.credit,
      l.supplier_id, l.customer_id, coalesce(su.name, cu.name) as party_name, l.memo`;
  }

  private lineJoins() {
    return sql`join ledger_accounts a on a.id = l.account_id
      left join suppliers su on su.id = l.supplier_id
      left join customers cu on cu.id = l.customer_id`;
  }

  /** One account's lines in the period, oldest first. */
  async cardLines(accountId: number, from: string, to: string, withCorrections: boolean): Promise<CardLineRecord[]> {
    const { rows } = await sql<CardLineRecord>`
      select ${this.lineColumns()}, ${entryDay} as entry_date, e.kind, e.source_key, e.description, e.warning, e.reverses_id, e.reversed_at
      from ledger_lines l join ledger_entries e on e.id = l.entry_id ${this.lineJoins()}
      where l.account_id = ${accountId} and e.entry_date between ${from}::date and ${to}::date
        and (${withCorrections} or not ${correction})
      order by e.entry_date, e.id, l.id
    `.execute(this.db);
    return rows;
  }

  /** Every account's lines in the period, for the general ledger download. */
  async allLines(from: string, to: string): Promise<CardLineRecord[]> {
    const { rows } = await sql<CardLineRecord>`
      select ${this.lineColumns()}, ${entryDay} as entry_date, e.kind, e.source_key, e.description, e.warning, e.reverses_id, e.reversed_at
      from ledger_lines l join ledger_entries e on e.id = l.entry_id ${this.lineJoins()}
      where e.entry_date between ${from}::date and ${to}::date
      order by a.number, e.entry_date, e.id, l.id
    `.execute(this.db);
    return rows;
  }

  private entryColumns() {
    return sql`e.id, ${entryDay} as entry_date, e.kind, e.source_key, e.description, e.warning, e.reverses_id, e.reversed_at,
      u.name as created_by_name, e.created_at`;
  }

  /** A page of TREFIN's journal entries in the period, newest first: its document number or an account's number finds them. */
  async trefinJournal(filters: { from: string; to: string; search: string | null; limit: number; offset: number }) {
    const pattern = filters.search ? `%${filters.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const where = sql`e.dated between ${filters.from}::date and ${filters.to}::date
      and (${pattern}::text is null or e.reference ilike ${pattern}
        or exists (select 1 from trefin_journal_lines l where l.entry_id = e.id and (l.account = ${filters.search} or l.party ilike ${pattern})))`;
    const [page, count] = await Promise.all([
      sql<TrefinEntryRecord>`
        select e.id, to_char(e.dated, 'YYYY-MM-DD') as dated, e.kind, e.reference, e.source from trefin_journal_entries e
        where ${where} order by e.dated desc, e.id desc limit ${filters.limit} offset ${filters.offset}
      `.execute(this.db),
      sql<{ total: string }>`select count(*) as total from trefin_journal_entries e where ${where}`.execute(this.db),
    ]);
    return { entries: page.rows, total: Number(count.rows[0]?.total ?? 0) };
  }

  async findTrefinEntry(id: number): Promise<TrefinEntryRecord | undefined> {
    const { rows } = await sql<TrefinEntryRecord>`
      select id, to_char(dated, 'YYYY-MM-DD') as dated, kind, reference, source from trefin_journal_entries where id = ${id}
    `.execute(this.db);
    return rows[0];
  }

  async trefinLinesOf(entryIds: number[]) {
    if (entryIds.length === 0) return [];
    return this.db.selectFrom('trefin_journal_lines').select(['entry_id', 'account', 'party', 'debit', 'credit']).where('entry_id', 'in', entryIds).orderBy('id').execute();
  }

  /** What TREFIN's journal had on an account before a day. */
  async trefinBalanceBefore(account: string, from: string): Promise<number> {
    const { rows } = await sql<{ balance: string }>`
      select coalesce(sum(debit - credit), 0) as balance from trefin_journal_lines where account = ${account} and dated < ${from}::date
    `.execute(this.db);
    return Number(rows[0]?.balance ?? 0);
  }

  /** One account's lines in TREFIN's journal in the period, oldest first. */
  trefinCardLines(account: string, from: string, to: string) {
    return this.db
      .selectFrom('trefin_journal_lines as l')
      .innerJoin('trefin_journal_entries as e', 'e.id', 'l.entry_id')
      .select(['l.id', 'e.id as entry_id', sql<string>`to_char(l.dated, 'YYYY-MM-DD')`.as('dated'), 'e.kind', 'e.reference', 'l.party', 'l.debit', 'l.credit'])
      .where('l.account', '=', account)
      .where('l.dated', '>=', from)
      .where('l.dated', '<=', to)
      .orderBy('l.dated')
      .orderBy('e.id')
      .orderBy('l.id')
      .execute();
  }

  /** A page of entries in the period, newest first. */
  async journal(filters: {
    from: string;
    to: string;
    search: string | null;
    withCorrections: boolean;
    limit: number;
    offset: number;
  }): Promise<{ entries: EntryRecord[]; total: number }> {
    const pattern = filters.search ? `%${filters.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const where = sql`e.entry_date between ${filters.from}::date and ${filters.to}::date
      and (${filters.withCorrections} or not ${correction})
      and (${pattern}::text is null or e.description ilike ${pattern} or e.id::text = ${filters.search}
        or exists (select 1 from ledger_lines l join ledger_accounts a on a.id = l.account_id
                   where l.entry_id = e.id and (a.number = ${filters.search} or a.name ilike ${pattern})))`;
    const [page, count] = await Promise.all([
      sql<EntryRecord>`
        select ${this.entryColumns()} from ledger_entries e left join users u on u.id = e.created_by
        where ${where} order by e.entry_date desc, e.id desc limit ${filters.limit} offset ${filters.offset}
      `.execute(this.db),
      sql<{ total: string }>`select count(*) as total from ledger_entries e where ${where}`.execute(this.db),
    ]);
    return { entries: page.rows, total: Number(count.rows[0]?.total ?? 0) };
  }

  async entriesForSources(sourceKeys: string[]): Promise<EntryRecord[]> {
    if (sourceKeys.length === 0) return [];
    const { rows } = await sql<EntryRecord>`
      select ${this.entryColumns()} from ledger_entries e left join users u on u.id = e.created_by
      where e.source_key = any(${sourceKeys}::text[]) order by e.id
    `.execute(this.db);
    return rows;
  }

  async findEntry(id: number): Promise<EntryRecord | undefined> {
    const { rows } = await sql<EntryRecord>`
      select ${this.entryColumns()} from ledger_entries e left join users u on u.id = e.created_by where e.id = ${id}
    `.execute(this.db);
    return rows[0];
  }

  async linesOf(entryIds: number[]): Promise<LineRecord[]> {
    if (entryIds.length === 0) return [];
    const { rows } = await sql<LineRecord>`
      select ${this.lineColumns()} from ledger_lines l ${this.lineJoins()}
      where l.entry_id = any(${entryIds}::int[]) order by l.entry_id, l.id
    `.execute(this.db);
    return rows;
  }

  async addManualEntry(values: { date: string; description: string; createdBy: number }): Promise<number> {
    const row = await this.db
      .insertInto('ledger_entries')
      .values({ entry_date: values.date, kind: 'manual', description: values.description, created_by: values.createdBy })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async links(): Promise<Array<{ key: string; account_id: number }>> {
    return this.db.selectFrom('ledger_links').select(['key', 'account_id']).orderBy('key').execute();
  }

  async setLink(key: string, accountId: number): Promise<void> {
    await this.db
      .insertInto('ledger_links')
      .values({ key, account_id: accountId })
      .onConflict((oc) => oc.column('key').doUpdateSet({ account_id: accountId }))
      .execute();
  }

  /** Entries with something the books couldn't post as they should, in the period. */
  async warnings(from: string, to: string): Promise<Array<{ warning: string; entries: string; items: string }>> {
    const { rows } = await sql<{ warning: string; entries: string; items: string }>`
      select split_part(e.warning, ':', 1) as warning, count(*) as entries,
        sum(coalesce(nullif(split_part(e.warning, ':', 2), '')::int, 1)) as items
      from ledger_entries e
      where e.warning is not null and e.kind = 'auto' and e.reversed_at is null and e.entry_date between ${from}::date and ${to}::date
      group by 1
    `.execute(this.db);
    return rows;
  }
}
