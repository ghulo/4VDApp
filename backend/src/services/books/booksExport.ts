import type { CardLineRecord } from '../../repositories/BooksRepository.js';
import type { ExportColumn, Sheet } from '../../utils/spreadsheet.js';
import type { AccountDto, CardLineDto, EntryDto, Period, TrialBalanceRow } from '../BooksService.js';
import type { SourceKind } from './postingRules.js';

export type BooksLanguage = 'sq' | 'en';

/** Words for the books' downloads, in the accountant's language or English. */
const WORDS = {
  sq: {
    kinds: {
      checkout: 'Shitje',
      return: 'Kthim',
      write_off: 'Asgjësim',
      count_line: 'Numërim stoku',
      adjustment: 'Korrigjim stoku',
      bill: 'Faturë blerje',
      payment: 'Pagesë furnitorit',
      expense: 'Shpenzim',
      tab_payment: 'Pagesë klienti',
      manual: 'Urdhëresë',
      reversal: 'Anulim',
    } satisfies Record<SourceKind | 'manual' | 'reversal', string>,
    date: 'Data',
    entry: 'Nr.',
    what: 'Dokumenti',
    description: 'Përshkrimi',
    account: 'Llogaria',
    accountName: 'Emërtimi',
    party: 'Subjekti',
    debit: 'Debi',
    credit: 'Kredi',
    balance: 'Saldo',
    opening: 'Saldo fillestare',
    closing: 'Saldo përfundimtare',
    trialBalance: 'Bilanci provues',
    journal: 'Libri i urdhëresave',
    ledger: 'Libri kryesor',
    card: 'Kartela e llogarisë',
    range: (from: string, to: string) => `${from} deri ${to}`,
  },
  en: {
    kinds: {
      checkout: 'Sale',
      return: 'Return',
      write_off: 'Write-off',
      count_line: 'Stock count',
      adjustment: 'Stock correction',
      bill: 'Supplier bill',
      payment: 'Supplier payment',
      expense: 'Expense',
      tab_payment: 'Customer payment',
      manual: 'Manual entry',
      reversal: 'Reversal',
    } satisfies Record<SourceKind | 'manual' | 'reversal', string>,
    date: 'Date',
    entry: 'No.',
    what: 'Document',
    description: 'Description',
    account: 'Account',
    accountName: 'Name',
    party: 'Partner',
    debit: 'Debit',
    credit: 'Credit',
    balance: 'Balance',
    opening: 'Opening balance',
    closing: 'Closing balance',
    trialBalance: 'Trial balance',
    journal: 'Journal',
    ledger: 'General ledger',
    card: 'Account card',
    range: (from: string, to: string) => `${from} to ${to}`,
  },
};

/** What kind of document wrote an entry, in words. */
function kindOf(words: (typeof WORDS)['en'], entry: { kind: string; source: string | null }): string {
  if (entry.kind === 'reversal') return words.kinds.reversal;
  if (entry.kind === 'manual' || entry.source === null) return words.kinds.manual;
  return words.kinds[entry.source.split(':')[0] as SourceKind] ?? entry.source;
}

const signedDebit = (value: number) => (value > 0 ? value : null);
const signedCredit = (value: number) => (value < 0 ? -value : null);

export function trialBalanceSheet(rows: TrialBalanceRow[], period: Period, language: BooksLanguage): { basename: string; sheet: Sheet<TrialBalanceRow> } {
  const w = WORDS[language];
  const columns: ExportColumn<TrialBalanceRow>[] = [
    { header: w.account, value: (row) => row.number },
    { header: w.accountName, value: (row) => row.name },
    { header: `${w.opening} ${w.debit}`, kind: 'money', total: true, value: (row) => signedDebit(row.opening) },
    { header: `${w.opening} ${w.credit}`, kind: 'money', total: true, value: (row) => signedCredit(row.opening) },
    { header: w.debit, kind: 'money', total: true, value: (row) => row.debit },
    { header: w.credit, kind: 'money', total: true, value: (row) => row.credit },
    { header: `${w.closing} ${w.debit}`, kind: 'money', total: true, value: (row) => signedDebit(row.closing) },
    { header: `${w.closing} ${w.credit}`, kind: 'money', total: true, value: (row) => signedCredit(row.closing) },
  ];
  return {
    basename: `4vd-trial-balance-${period.from}-to-${period.to}`,
    sheet: { name: w.trialBalance, subtitle: w.range(period.from, period.to), columns, rows, totals: { inCsv: true } },
  };
}

interface JournalRow {
  entry: EntryDto;
  line: EntryDto['lines'][number];
}

export function journalSheet(entries: EntryDto[], period: Period, language: BooksLanguage): { basename: string; sheet: Sheet<JournalRow> } {
  const w = WORDS[language];
  const rows = entries.flatMap((entry) => entry.lines.map((line) => ({ entry, line })));
  const columns: ExportColumn<JournalRow>[] = [
    { header: w.entry, value: (row) => row.entry.id },
    { header: w.date, kind: 'date', value: (row) => row.entry.date },
    { header: w.what, value: (row) => kindOf(w, row.entry) },
    { header: w.description, value: (row) => row.entry.description },
    { header: w.account, value: (row) => row.line.accountNumber },
    { header: w.accountName, value: (row) => row.line.accountName },
    { header: w.party, value: (row) => row.line.party?.name ?? row.line.memo },
    { header: w.debit, kind: 'money', total: true, value: (row) => row.line.debit || null },
    { header: w.credit, kind: 'money', total: true, value: (row) => row.line.credit || null },
  ];
  return {
    basename: `4vd-journal-${period.from}-to-${period.to}`,
    sheet: { name: w.journal, subtitle: w.range(period.from, period.to), columns, rows, totals: { inCsv: false } },
  };
}

export function ledgerSheet(lines: CardLineRecord[], period: Period, language: BooksLanguage): { basename: string; sheet: Sheet<CardLineRecord> } {
  const w = WORDS[language];
  const columns: ExportColumn<CardLineRecord>[] = [
    { header: w.account, value: (row) => row.account_number },
    { header: w.accountName, value: (row) => row.account_name },
    { header: w.date, kind: 'date', value: (row) => row.entry_date },
    { header: w.entry, value: (row) => row.entry_id },
    { header: w.what, value: (row) => kindOf(w, { kind: row.kind, source: row.source_key }) },
    { header: w.description, value: (row) => row.description },
    { header: w.party, value: (row) => row.party_name ?? row.memo },
    { header: w.debit, kind: 'money', total: true, value: (row) => Number(row.debit) || null },
    { header: w.credit, kind: 'money', total: true, value: (row) => Number(row.credit) || null },
  ];
  return {
    basename: `4vd-general-ledger-${period.from}-to-${period.to}`,
    sheet: { name: w.ledger, subtitle: w.range(period.from, period.to), columns, rows: lines, totals: { inCsv: false } },
  };
}

export function cardSheet(
  card: { account: AccountDto; opening: number; lines: CardLineDto[] },
  period: Period,
  language: BooksLanguage,
): { basename: string; sheet: Sheet<CardLineDto> } {
  const w = WORDS[language];
  const openingRow: CardLineDto = {
    entryId: 0,
    date: period.from,
    kind: 'manual',
    source: null,
    description: w.opening,
    warning: null,
    party: null,
    memo: null,
    debit: 0,
    credit: 0,
    balance: card.opening,
    correction: false,
    target: null,
  };
  const columns: ExportColumn<CardLineDto>[] = [
    { header: w.date, kind: 'date', value: (row) => row.date },
    { header: w.entry, value: (row) => row.entryId || null },
    { header: w.what, value: (row) => (row.entryId ? kindOf(w, row) : null) },
    { header: w.description, value: (row) => row.description },
    { header: w.party, value: (row) => row.party?.name ?? row.memo },
    { header: w.debit, kind: 'money', total: true, value: (row) => row.debit || null },
    { header: w.credit, kind: 'money', total: true, value: (row) => row.credit || null },
    { header: w.balance, kind: 'money', value: (row) => row.balance },
  ];
  return {
    basename: `4vd-account-${card.account.number}-${period.from}-to-${period.to}`,
    sheet: {
      name: `${w.card} ${card.account.number}`,
      subtitle: `${card.account.number} ${card.account.name}, ${w.range(period.from, period.to)}`,
      columns,
      rows: [openingRow, ...card.lines],
      totals: { inCsv: false },
    },
  };
}
