import { sql } from 'kysely';
import type { AccountClass, CashFlowActivity } from '../../constants/chartOfAccounts.js';
import type { DatabaseClient } from '../../database/connection.js';
import { roundMoney } from '../../utils/money.js';
import type { BooksPoster } from '../books/BooksPoster.js';

/** The source key of the entry that closes a year into retained earnings: "year_close:2026". */
export const CLOSING_PREFIX = 'year_close:';
/** Where the money is: every till, safe and bank account. Places link their own accounts too. */
const CASH_GROUP = 'Paratë në arkë dhe bankë';

export interface Period {
  from: string;
  to: string;
}

/** A figure and the same figure for the period it is compared with (null: no comparison asked for). */
export interface Figure {
  amount: number;
  compare: number | null;
}

export interface StatementLine extends Figure {
  /** Null for a line 4VD works out, like this year's profit before the year is closed. */
  accountId: number | null;
  number: string | null;
  name: string;
  /** For lines without an account: what it is, for the dashboard's words. */
  key?: 'unclosed_profit';
}

export interface StatementGroup extends Figure {
  /** The account group's name; empty when the section is one plain list. */
  name: string;
  lines: StatementLine[];
}

export interface StatementSection<TKey extends string> extends Figure {
  key: TKey;
  groups: StatementGroup[];
}

export type IncomeSectionKey = 'revenue' | 'cost_of_sales' | 'expenses' | 'other_income' | 'other_expenses' | 'profit_tax';
export type IncomeTotalKey = 'revenue' | 'costOfSales' | 'grossProfit' | 'expenses' | 'operatingProfit' | 'otherIncome' | 'otherExpenses' | 'profitBeforeTax' | 'profitTax' | 'netProfit';

export interface IncomeStatement {
  period: Period;
  compare: Period | null;
  sections: Array<StatementSection<IncomeSectionKey>>;
  totals: Record<IncomeTotalKey, Figure>;
}

export type BalanceSectionKey = 'current_assets' | 'fixed_assets' | 'short_liabilities' | 'long_liabilities' | 'equity';

export interface BalanceSheet {
  date: string;
  compareDate: string | null;
  sections: Array<StatementSection<BalanceSectionKey>>;
  totals: Record<'assets' | 'liabilities' | 'equity' | 'liabilitiesAndEquity', Figure>;
  /** Assets equal liabilities plus equity, to the cent, on both dates. */
  balanced: boolean;
}

export interface CashFlowStatement {
  period: Period;
  compare: Period | null;
  sections: Array<StatementSection<CashFlowActivity>>;
  totals: Record<'opening' | 'net' | 'closing', Figure>;
  /** Cash at the start plus what came in and went out equals cash at the end. */
  balanced: boolean;
}

export interface EquityRow {
  accountId: number | null;
  number: string | null;
  name: string;
  key?: 'unclosed_profit';
  start: number;
  increase: number;
  decrease: number;
  end: number;
}

export interface EquityChanges {
  period: Period;
  rows: EquityRow[];
  total: Omit<EquityRow, 'accountId' | 'number' | 'name' | 'key'>;
  /** Profit or loss of the period, before it is moved anywhere. */
  profit: number;
}

interface AccountRow {
  id: number;
  number: string;
  name: string;
  class: AccountClass;
  type_name: string;
  group_name: string;
  cash_flow: CashFlowActivity;
}

const PROFIT_CLASSES: readonly AccountClass[] = ['revenue', 'cost_of_sales', 'expense', 'other_income', 'other_expense'];
/** Classes read as credits: income, what is owed, and what is the owners'. */
const CREDIT_CLASSES: readonly AccountClass[] = ['revenue', 'other_income', 'liability', 'equity'];

/** "2026-03-01" → "2026-02-28". */
export function dayBefore(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

const cents = (amount: number) => Math.round(amount * 100);
const sumOf = (figures: Figure[], compare: boolean): Figure => ({
  amount: roundMoney(figures.reduce((sum, figure) => sum + figure.amount, 0)),
  compare: compare ? roundMoney(figures.reduce((sum, figure) => sum + (figure.compare ?? 0), 0)) : null,
});
const minus = (a: Figure, b: Figure): Figure => ({
  amount: roundMoney(a.amount - b.amount),
  compare: a.compare === null ? null : roundMoney(a.compare - (b.compare ?? 0)),
});

/** A fixed asset or a long-term debt, by TREFIN's "type" ("Pasuria Themelore", "Detyrimet Afatgjatë"). */
const isLongTerm = (account: AccountRow) => /themelore|afatgjat|fixed|long/i.test(account.type_name);

/**
 * The financial statements, read straight from the books: balance sheet,
 * income statement, changes in equity and cash flow. Income and costs leave
 * out the entry that closes a year, so a closed year still shows what it made.
 */
export class StatementsService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly poster: BooksPoster,
  ) {}

  private accounts(): Promise<AccountRow[]> {
    return this.db.selectFrom('ledger_accounts').select(['id', 'number', 'name', 'class', 'type_name', 'group_name', 'cash_flow']).orderBy('number').execute();
  }

  /** Debits minus credits per account, between two days (from null: since the start). */
  private async nets(from: string | null, to: string, withClosing: boolean, db: DatabaseClient = this.db): Promise<Map<number, number>> {
    const { rows } = await sql<{ account_id: number; net: string }>`
      select l.account_id, sum(l.debit - l.credit) as net
      from ledger_lines l join ledger_entries e on e.id = l.entry_id
      where e.entry_date <= ${to}::date
        and (${from}::date is null or e.entry_date >= ${from}::date)
        and (${withClosing} or e.source_key is null or e.source_key not like ${`${CLOSING_PREFIX}%`})
      group by l.account_id
    `.execute(db);
    return new Map(rows.map((row) => [row.account_id, Number(row.net)]));
  }

  /** The account that holds the year's profit tax, kept apart from other costs. */
  private async link(key: string, db: DatabaseClient = this.db): Promise<number | null> {
    const row = await db.selectFrom('ledger_links').select('account_id').where('key', '=', key).executeTakeFirst();
    return row?.account_id ?? null;
  }

  private async cashAccounts(): Promise<number[]> {
    const { rows } = await sql<{ id: number }>`
      select id from ledger_accounts where group_name = ${CASH_GROUP}
      union select account_id from money_places where account_id is not null
    `.execute(this.db);
    return rows.map((row) => row.id);
  }

  /**
   * One line per account with a figure in either period, in the account's
   * natural sign (income and debts as positives), grouped by the account group
   * when `grouped`.
   */
  private section<TKey extends string>(
    key: TKey,
    accounts: AccountRow[],
    current: Map<number, number>,
    previous: Map<number, number> | null,
    grouped: boolean,
    extra: StatementLine[] = [],
  ): StatementSection<TKey> {
    const sign = (account: AccountRow) => (CREDIT_CLASSES.includes(account.class) ? -1 : 1);
    const lines: Array<StatementLine & { group: string }> = accounts
      .map((account) => ({
        accountId: account.id,
        number: account.number,
        name: account.name,
        group: account.group_name,
        amount: roundMoney(sign(account) * (current.get(account.id) ?? 0)),
        compare: previous ? roundMoney(sign(account) * (previous.get(account.id) ?? 0)) : null,
      }))
      .filter((line) => cents(line.amount) !== 0 || cents(line.compare ?? 0) !== 0);
    const withExtra = [...lines, ...extra.filter((line) => cents(line.amount) !== 0 || cents(line.compare ?? 0) !== 0).map((line) => ({ ...line, group: '' }))];
    const groups: StatementGroup[] = [];
    for (const line of withExtra) {
      const name = grouped ? line.group : '';
      let group = groups.find((candidate) => candidate.name === name);
      if (!group) {
        group = { name, amount: 0, compare: previous ? 0 : null, lines: [] };
        groups.push(group);
      }
      const { group: _group, ...rest } = line;
      group.lines.push(rest);
    }
    for (const group of groups) Object.assign(group, sumOf(group.lines, previous !== null));
    return { key, ...sumOf(groups, previous !== null), groups };
  }

  async incomeStatement(period: Period, compare: Period | null = null): Promise<IncomeStatement> {
    await this.poster.sync();
    const [accounts, current, previous, taxAccount] = await Promise.all([
      this.accounts(),
      this.nets(period.from, period.to, false),
      compare ? this.nets(compare.from, compare.to, false) : Promise.resolve(null),
      this.link('profit_tax'),
    ]);
    const of = (accountClass: AccountClass) => accounts.filter((account) => account.class === accountClass && account.id !== taxAccount);
    const sections = [
      this.section('revenue' as const, of('revenue'), current, previous, false),
      this.section('cost_of_sales' as const, of('cost_of_sales'), current, previous, false),
      this.section('expenses' as const, of('expense'), current, previous, false),
      this.section('other_income' as const, of('other_income'), current, previous, false),
      this.section('other_expenses' as const, of('other_expense'), current, previous, false),
      this.section('profit_tax' as const, accounts.filter((account) => account.id === taxAccount), current, previous, false),
    ];
    const total = (key: IncomeSectionKey): Figure => {
      const section = sections.find((candidate) => candidate.key === key)!;
      return { amount: section.amount, compare: section.compare };
    };
    const grossProfit = minus(total('revenue'), total('cost_of_sales'));
    const operatingProfit = minus(grossProfit, total('expenses'));
    const profitBeforeTax = minus(sumOf([operatingProfit, total('other_income')], compare !== null), total('other_expenses'));
    return {
      period,
      compare,
      sections,
      totals: {
        revenue: total('revenue'),
        costOfSales: total('cost_of_sales'),
        grossProfit,
        expenses: total('expenses'),
        operatingProfit,
        otherIncome: total('other_income'),
        otherExpenses: total('other_expenses'),
        profitBeforeTax,
        profitTax: total('profit_tax'),
        netProfit: minus(profitBeforeTax, total('profit_tax')),
      },
    };
  }

  /** Profit before the profit tax over some days, for the quarterly instalments. */
  async profitBeforeTax(period: Period): Promise<number> {
    return (await this.incomeStatement(period)).totals.profitBeforeTax.amount;
  }

  /** Income minus costs of every year not yet closed, up to a day: profit that is still the year's, not retained earnings. */
  private unclosedProfit(accounts: AccountRow[], nets: Map<number, number>): number {
    return roundMoney(-accounts.filter((account) => PROFIT_CLASSES.includes(account.class)).reduce((sum, account) => sum + (nets.get(account.id) ?? 0), 0));
  }

  async balanceSheet(date: string, compareDate: string | null = null): Promise<BalanceSheet> {
    await this.poster.sync();
    const [accounts, current, previous] = await Promise.all([
      this.accounts(),
      this.nets(null, date, true),
      compareDate ? this.nets(null, compareDate, true) : Promise.resolve(null),
    ]);
    const assets = accounts.filter((account) => account.class === 'asset');
    const liabilities = accounts.filter((account) => account.class === 'liability');
    const profit: StatementLine = {
      accountId: null,
      number: null,
      name: '',
      key: 'unclosed_profit',
      amount: this.unclosedProfit(accounts, current),
      compare: previous ? this.unclosedProfit(accounts, previous) : null,
    };
    const sections = [
      this.section('current_assets' as const, assets.filter((account) => !isLongTerm(account)), current, previous, true),
      this.section('fixed_assets' as const, assets.filter(isLongTerm), current, previous, true),
      this.section('short_liabilities' as const, liabilities.filter((account) => !isLongTerm(account)), current, previous, true),
      this.section('long_liabilities' as const, liabilities.filter(isLongTerm), current, previous, true),
      this.section('equity' as const, accounts.filter((account) => account.class === 'equity'), current, previous, true, [profit]),
    ];
    const figure = (...keys: BalanceSectionKey[]) => sumOf(sections.filter((section) => keys.includes(section.key)), previous !== null);
    const totals = {
      assets: figure('current_assets', 'fixed_assets'),
      liabilities: figure('short_liabilities', 'long_liabilities'),
      equity: figure('equity'),
      liabilitiesAndEquity: figure('short_liabilities', 'long_liabilities', 'equity'),
    };
    return {
      date,
      compareDate,
      sections,
      totals,
      balanced: cents(totals.assets.amount) === cents(totals.liabilitiesAndEquity.amount) && cents(totals.assets.compare ?? 0) === cents(totals.liabilitiesAndEquity.compare ?? 0),
    };
  }

  /**
   * Cash flow, the direct way: every entry that moved a till, the safe or a
   * bank account is split over the other accounts it touched, and each of
   * those says whether it is running the shop, equipment or the owners and
   * loans. Moves between two places of money cancel out.
   */
  async cashFlow(period: Period, compare: Period | null = null): Promise<CashFlowStatement> {
    await this.poster.sync();
    const [accounts, cash] = await Promise.all([this.accounts(), this.cashAccounts()]);
    // A sale's entry also moves the goods' cost out of stock (cost of sales against stock): no cash moves
    // there, so inside each entry a line on the same side as the cash is left out together with an
    // opposite line of the same amount, preferring a balance sheet account (stock) over income or costs.
    const flows = async (range: Period) => {
      const { rows } = await sql<{ account_id: number; flow: string }>`
        with moved as (
          select l.entry_id, l.account_id, sum(l.debit - l.credit) as n, bool_or(l.account_id = any(${cash}::int[])) as is_cash
          from ledger_lines l join ledger_entries e on e.id = l.entry_id
          where e.entry_date between ${range.from}::date and ${range.to}::date
            and exists (select 1 from ledger_lines c where c.entry_id = l.entry_id and c.account_id = any(${cash}::int[]))
          group by l.entry_id, l.account_id
        ),
        cash_side as (select entry_id, sum(n) as c from moved where is_cash group by entry_id),
        other as (
          select m.entry_id, m.account_id, m.n, cs.c, a.class
          from moved m join cash_side cs on cs.entry_id = m.entry_id join ledger_accounts a on a.id = m.account_id
          where not m.is_cash and m.n <> 0
        ),
        pairs as (
          select distinct on (s.entry_id, s.account_id) s.entry_id, s.account_id as same_id, p.account_id as partner_id
          from other s join other p on p.entry_id = s.entry_id and p.n = -s.n
          where sign(s.n) = sign(s.c)
          order by s.entry_id, s.account_id, (p.class in ('asset', 'liability', 'equity')) desc, p.account_id
        ),
        dropped as (
          select entry_id, same_id as account_id from pairs
          union select entry_id, partner_id from pairs
        )
        select o.account_id, sum(o.n) as flow
        from other o
        where not exists (select 1 from dropped d where d.entry_id = o.entry_id and d.account_id = o.account_id)
        group by o.account_id
      `.execute(this.db);
      // Money comes in when the other side is credited: flip so money in is positive whatever the account.
      return new Map(rows.map((row) => [row.account_id, -Number(row.flow)]));
    };
    const cashOn = async (day: string) => {
      const nets = await this.nets(null, day, true);
      return roundMoney(cash.reduce((sum, id) => sum + (nets.get(id) ?? 0), 0));
    };
    const [current, previous, opening, closing, openingBefore, closingBefore] = await Promise.all([
      flows(period),
      compare ? flows(compare) : Promise.resolve(null),
      cashOn(dayBefore(period.from)),
      cashOn(period.to),
      compare ? cashOn(dayBefore(compare.from)) : Promise.resolve(null),
      compare ? cashOn(compare.to) : Promise.resolve(null),
    ]);
    // `section` reads credit accounts as negatives; flows are already signed as money in, so give every account the debit sign.
    const asDebit = accounts.filter((account) => !cash.includes(account.id)).map((account) => ({ ...account, class: 'asset' as AccountClass }));
    const sections = (['operating', 'investing', 'financing'] as const).map((activity) =>
      this.section(activity, asDebit.filter((account) => account.cash_flow === activity), current, previous, false),
    );
    const net = sumOf(sections, compare !== null);
    const totals = {
      opening: { amount: opening, compare: openingBefore },
      net,
      closing: { amount: closing, compare: closingBefore },
    };
    return {
      period,
      compare,
      sections,
      totals,
      balanced: cents(opening + net.amount) === cents(closing) && cents((openingBefore ?? 0) + (net.compare ?? 0)) === cents(closingBefore ?? 0),
    };
  }

  /**
   * What the owners' part did over a period: each equity account from start to
   * end, plus the profit not yet closed into retained earnings.
   */
  async equityChanges(period: Period): Promise<EquityChanges> {
    await this.poster.sync();
    const accounts = await this.accounts();
    const equity = accounts.filter((account) => account.class === 'equity');
    const [before, after, profitNets] = await Promise.all([
      this.nets(null, dayBefore(period.from), true),
      this.nets(null, period.to, true),
      this.nets(period.from, period.to, false),
    ]);
    const { rows: moves } = await sql<{ account_id: number; debit: string; credit: string }>`
      select l.account_id, sum(l.debit) as debit, sum(l.credit) as credit
      from ledger_lines l join ledger_entries e on e.id = l.entry_id
      where e.entry_date between ${period.from}::date and ${period.to}::date and l.account_id = any(${equity.map((account) => account.id)}::int[])
      group by l.account_id
    `.execute(this.db);
    const rows: EquityRow[] = equity
      .map((account) => {
        const move = moves.find((row) => row.account_id === account.id);
        return {
          accountId: account.id,
          number: account.number,
          name: account.name,
          start: roundMoney(-(before.get(account.id) ?? 0)),
          increase: roundMoney(Number(move?.credit ?? 0)),
          decrease: roundMoney(Number(move?.debit ?? 0)),
          end: roundMoney(-(after.get(account.id) ?? 0)),
        };
      })
      .filter((row) => [row.start, row.increase, row.decrease, row.end].some((value) => cents(value) !== 0));
    const start = this.unclosedProfit(accounts, before);
    const end = this.unclosedProfit(accounts, after);
    const profit = this.unclosedProfit(accounts, profitNets);
    // What a year close moved out of this year's profit into retained earnings.
    const moved = roundMoney(start + profit - end);
    const profitRow: EquityRow = {
      accountId: null,
      number: null,
      name: '',
      key: 'unclosed_profit',
      start,
      increase: profit > 0 ? profit : 0,
      decrease: roundMoney((profit < 0 ? -profit : 0) + moved),
      end,
    };
    if ([start, profit, end].some((value) => cents(value) !== 0)) rows.push(profitRow);
    const add = (pick: (row: EquityRow) => number) => roundMoney(rows.reduce((sum, row) => sum + pick(row), 0));
    return {
      period,
      rows,
      total: { start: add((row) => row.start), increase: add((row) => row.increase), decrease: add((row) => row.decrease), end: add((row) => row.end) },
      profit,
    };
  }

  /** What the year's income and cost accounts hold, for the closing entry (closing entries of other years don't fall in it). */
  async profitAccounts(year: number, db: DatabaseClient): Promise<Array<{ accountId: number; net: number }>> {
    const accounts = (await db.selectFrom('ledger_accounts').select(['id', 'class']).execute()) as Array<{ id: number; class: AccountClass }>;
    const nets = await this.nets(`${year}-01-01`, `${year}-12-31`, true, db);
    return accounts
      .filter((account) => PROFIT_CLASSES.includes(account.class))
      .map((account) => ({ accountId: account.id, net: roundMoney(nets.get(account.id) ?? 0) }))
      .filter((row) => cents(row.net) !== 0);
  }
}
