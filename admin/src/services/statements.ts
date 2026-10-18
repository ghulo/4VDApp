import type { Language } from '../i18n/language';
import { apiDownload, apiRequest, saveDownload } from './apiClient';
import type { MoneyPlaceKind, UserRole } from './types';

/** The four financial statements, as the server reads them from the books (backend services/statements). */
export type StatementKind = 'balance' | 'income' | 'equity' | 'cashflow';
export type PrintFinish = 'official' | 'bank';

export interface Figure {
  amount: number;
  compare: number | null;
}

export interface StatementLine extends Figure {
  accountId: number | null;
  number: string | null;
  name: string;
  key?: 'unclosed_profit';
}

export interface StatementGroup extends Figure {
  name: string;
  lines: StatementLine[];
}

export interface StatementSection<TKey extends string = string> extends Figure {
  key: TKey;
  groups: StatementGroup[];
}

export interface Period {
  from: string;
  to: string;
}

export type IncomeSectionKey = 'revenue' | 'cost_of_sales' | 'expenses' | 'other_income' | 'other_expenses' | 'profit_tax';
export interface IncomeStatement {
  period: Period;
  compare: Period | null;
  sections: Array<StatementSection<IncomeSectionKey>>;
  totals: Record<'revenue' | 'costOfSales' | 'grossProfit' | 'expenses' | 'operatingProfit' | 'otherIncome' | 'otherExpenses' | 'profitBeforeTax' | 'profitTax' | 'netProfit', Figure>;
}

export type BalanceSectionKey = 'current_assets' | 'fixed_assets' | 'short_liabilities' | 'long_liabilities' | 'equity';
export interface BalanceSheet {
  date: string;
  compareDate: string | null;
  sections: Array<StatementSection<BalanceSectionKey>>;
  totals: Record<'assets' | 'liabilities' | 'equity' | 'liabilitiesAndEquity', Figure>;
  balanced: boolean;
}

export type CashFlowKey = 'operating' | 'investing' | 'financing';
export interface CashFlowStatement {
  period: Period;
  compare: Period | null;
  sections: Array<StatementSection<CashFlowKey>>;
  totals: Record<'opening' | 'net' | 'closing', Figure>;
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
  total: Pick<EquityRow, 'start' | 'increase' | 'decrease' | 'end'>;
  profit: number;
}

export interface StatementByKind {
  balance: BalanceSheet;
  income: IncomeStatement;
  cashflow: CashFlowStatement;
  equity: EquityChanges;
}

export type QuarterStatus = 'later' | 'running' | 'due' | 'late' | 'paid' | 'nothing';

export interface Instalment {
  id: number;
  amount: number;
  paidOn: string;
  place: { id: number; kind: MoneyPlaceKind; name: string | null };
  entryId: number | null;
  note: string | null;
  by: string | null;
}

export interface Quarter {
  quarter: 1 | 2 | 3 | 4;
  from: string;
  to: string;
  due: string;
  status: QuarterStatus;
  profit: number | null;
  tax: number | null;
  paidBefore: number;
  suggested: number | null;
  instalment: Instalment | null;
}

export type CloseBlocker = 'not_over' | 'earlier_open' | 'empty';

export interface BookYear {
  year: number;
  rate: number;
  startsInYear: string | null;
  quarters: Quarter[];
  paid: number;
  close: {
    closed: { at: string; by: string | null; profit: number; tax: number; taxEntryId: number | null; closeEntryId: number | null } | null;
    blockers: CloseBlocker[];
    earlierOpen: number | null;
    unfiledMonths: string[];
    profitBeforeTax: number;
    suggestedTax: number;
    canReopen: boolean;
  };
}

/** The period asked for, and the one to compare with (a balance sheet reads only the last days). */
export interface StatementQuery extends Period {
  compareFrom?: string;
  compareTo?: string;
}

export const statementsApi = {
  get: async <K extends StatementKind>(kind: K, query: StatementQuery) =>
    (await apiRequest<StatementByKind[K]>(`/books/statements/${kind}`, { query: { ...query } })).data,
  /** The statement as a page to print or save as PDF. */
  page: async (kind: StatementKind, query: StatementQuery, finish: PrintFinish, lang: Language) => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return (await apiDownload(`/books/statements/${kind}/download`, { ...query, format: 'html', finish, lang, tz })).blob.text();
  },
  async downloadXlsx(kind: StatementKind, query: StatementQuery, lang: Language): Promise<void> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { blob, filename } = await apiDownload(`/books/statements/${kind}/download`, { ...query, format: 'xlsx', lang, tz });
    saveDownload(blob, filename ?? `4vd-${kind}.xlsx`);
  },
  year: async (year: number) => (await apiRequest<BookYear>(`/books/year/${year}`)).data,
  close: async (year: number, tax: number) => (await apiRequest<BookYear>(`/books/year/${year}/close`, { method: 'POST', body: { tax } })).data,
  reopen: async (year: number, reason: string) => (await apiRequest<BookYear>(`/books/year/${year}/reopen`, { method: 'POST', body: { reason } })).data,
  pay: async (year: number, input: { quarter: number; amount: number; day: string; placeId: number; note?: string | null }) =>
    (await apiRequest<BookYear>(`/books/year/${year}/instalments`, { method: 'POST', body: input })).data,
  undo: async (id: number) => (await apiRequest<BookYear>(`/books/instalments/${id}`, { method: 'DELETE' })).data,
};

/** Who closes and reopens a year: the same people who reopen a VAT month. */
export const canCloseYear = (role: UserRole) => role === 'developer' || role === 'owner' || role === 'accountant';
/** Who records a profit tax instalment as paid: whoever files VAT. */
export const canPayTax = (role: UserRole) => role === 'developer' || role === 'admin' || role === 'owner' || role === 'accountant';
