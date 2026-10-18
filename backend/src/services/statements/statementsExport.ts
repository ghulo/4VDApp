import { type Language, LOCALE, money } from '../../i18n/language.js';
import type { ExportColumn, Sheet } from '../../utils/spreadsheet.js';
import type { BalanceSheet, CashFlowStatement, EquityChanges, IncomeStatement, StatementSection, StatementLine } from './StatementsService.js';

/**
 * The statements as downloads: an Excel workbook, and a page to print or save
 * as PDF in two finishes. "official" is the accountant's and ATK's: every
 * account with its number. "bank" is for a loan officer: one line per account
 * group, the shop's details on top and room to sign.
 */

export type StatementKind = 'balance' | 'income' | 'equity' | 'cashflow';
export type PrintFinish = 'official' | 'bank';

export type StatementData =
  | { kind: 'balance'; data: BalanceSheet }
  | { kind: 'income'; data: IncomeStatement }
  | { kind: 'cashflow'; data: CashFlowStatement }
  | { kind: 'equity'; data: EquityChanges };

const WORDS = {
  en: {
    balance: 'Balance sheet',
    income: 'Income statement',
    cashflow: 'Cash flow statement',
    equity: 'Changes in equity',
    revenue: 'Revenue',
    cost_of_sales: 'Cost of goods sold',
    expenses: 'Operating expenses',
    other_income: 'Other income',
    other_expenses: 'Other expenses',
    profit_tax: 'Profit tax',
    grossProfit: 'Gross profit',
    operatingProfit: 'Operating profit',
    profitBeforeTax: 'Profit before tax',
    netProfit: 'Net profit',
    assets: 'Assets',
    current_assets: 'Current assets',
    fixed_assets: 'Fixed assets',
    liabilitiesAndEquity: 'Liabilities and equity',
    short_liabilities: 'Short-term liabilities',
    long_liabilities: 'Long-term liabilities',
    equitySection: 'Equity',
    unclosed_profit: 'Profit of the year not yet closed',
    totalAssets: 'Total assets',
    totalLiabilitiesAndEquity: 'Total liabilities and equity',
    opening: 'Cash at the start',
    operating: 'Running the shop',
    investing: 'Equipment and other fixed assets',
    financing: 'Owners and loans',
    net: 'Net change in cash',
    closing: 'Cash at the end',
    start: 'At the start',
    increase: 'Added',
    decrease: 'Taken out',
    end: 'At the end',
    account: 'Account',
    number: 'No.',
    total: 'Total',
    totalOf: (what: string) => `Total ${what.toLowerCase()}`,
    asOn: (day: string) => `On ${day}`,
    range: (from: string, to: string) => `${from} to ${to}`,
    business: 'Business',
    nui: 'NUI',
    address: 'Address',
    madeFrom: (day: string) => `Prepared from 4VD's books on ${day}.`,
    unbalanced: 'The figures do not balance: check the books before handing this over.',
    signature: 'Signature and stamp',
    accountant: 'Accountant',
    director: 'Director',
    empty: 'Nothing in the books for this period.',
  },
  sq: {
    balance: 'Bilanci i gjendjes',
    income: 'Pasqyra e të ardhurave',
    cashflow: 'Pasqyra e rrjedhës së parasë',
    equity: 'Pasqyra e ndryshimeve në kapital',
    revenue: 'Të hyrat',
    cost_of_sales: 'Kostoja e mallit të shitur',
    expenses: 'Shpenzimet operative',
    other_income: 'Të hyrat tjera',
    other_expenses: 'Shpenzimet tjera',
    profit_tax: 'Tatimi në fitim',
    grossProfit: 'Fitimi bruto',
    operatingProfit: 'Fitimi operativ',
    profitBeforeTax: 'Fitimi para tatimit',
    netProfit: 'Fitimi neto',
    assets: 'Pasuritë',
    current_assets: 'Pasuritë qarkulluese',
    fixed_assets: 'Pasuritë themelore',
    liabilitiesAndEquity: 'Detyrimet dhe ekuiteti',
    short_liabilities: 'Detyrimet afatshkurtra',
    long_liabilities: 'Detyrimet afatgjata',
    equitySection: 'Ekuiteti',
    unclosed_profit: 'Fitimi i vitit ende i pambyllur',
    totalAssets: 'Gjithsej pasuritë',
    totalLiabilitiesAndEquity: 'Gjithsej detyrimet dhe ekuiteti',
    opening: 'Paraja në fillim',
    operating: 'Aktivitetet operative',
    investing: 'Aktivitetet investuese',
    financing: 'Aktivitetet financuese',
    net: 'Ndryshimi neto i parasë',
    closing: 'Paraja në fund',
    start: 'Në fillim',
    increase: 'Shtimet',
    decrease: 'Zbritjet',
    end: 'Në fund',
    account: 'Llogaria',
    number: 'Nr.',
    total: 'Gjithsej',
    totalOf: (what: string) => `Gjithsej ${what.toLowerCase()}`,
    asOn: (day: string) => `Më ${day}`,
    range: (from: string, to: string) => `${from} deri ${to}`,
    business: 'Biznesi',
    nui: 'NUI',
    address: 'Adresa',
    madeFrom: (day: string) => `Përgatitur nga librat e 4VD më ${day}.`,
    unbalanced: 'Shifrat nuk përputhen: kontrollo librat para se ta dorëzosh.',
    signature: 'Nënshkrimi dhe vula',
    accountant: 'Kontabilisti',
    director: 'Drejtori',
    empty: 'Asgjë në libra për këtë periudhë.',
  },
} as const;

type Words = (typeof WORDS)[Language];

const day = (value: string, language: Language) =>
  new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : LOCALE[language], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));

/** One row of a statement as it is printed or written to Excel. */
interface Row {
  number: string | null;
  label: string;
  amount: number | null;
  compare: number | null;
  style: 'heading' | 'group' | 'line' | 'subtotal' | 'total';
}

const lineLabel = (line: StatementLine, words: Words) => (line.key ? words[line.key] : line.name);

/** A section's rows: its heading, each account (or each group, for the bank), and its total. */
function sectionRows(section: StatementSection<string>, heading: string, words: Words, byGroup: boolean): Row[] {
  const rows: Row[] = [{ number: null, label: heading, amount: null, compare: null, style: 'heading' }];
  for (const group of section.groups) {
    if (byGroup && group.name) {
      rows.push({ number: null, label: group.name, amount: group.amount, compare: group.compare, style: 'line' });
      continue;
    }
    if (group.name && section.groups.length > 1) rows.push({ number: null, label: group.name, amount: null, compare: null, style: 'group' });
    for (const line of group.lines) rows.push({ number: line.number, label: lineLabel(line, words), amount: line.amount, compare: line.compare, style: 'line' });
  }
  rows.push({ number: null, label: words.totalOf(heading), amount: section.amount, compare: section.compare, style: 'subtotal' });
  return rows;
}

function rowsOf(statement: StatementData, words: Words, byGroup: boolean): Row[] {
  const total = (label: string, figure: { amount: number; compare: number | null }): Row => ({ number: null, label, amount: figure.amount, compare: figure.compare, style: 'total' });
  if (statement.kind === 'income') {
    const { sections, totals } = statement.data;
    const of = (key: string) => sections.find((section) => section.key === key)!;
    const part = (key: 'revenue' | 'cost_of_sales' | 'expenses' | 'other_income' | 'other_expenses' | 'profit_tax') => sectionRows(of(key), words[key], words, byGroup);
    return [
      ...part('revenue'),
      ...part('cost_of_sales'),
      total(words.grossProfit, totals.grossProfit),
      ...part('expenses'),
      total(words.operatingProfit, totals.operatingProfit),
      ...part('other_income'),
      ...part('other_expenses'),
      total(words.profitBeforeTax, totals.profitBeforeTax),
      ...part('profit_tax'),
      total(words.netProfit, totals.netProfit),
    ];
  }
  if (statement.kind === 'balance') {
    const { sections, totals } = statement.data;
    const part = (key: 'current_assets' | 'fixed_assets' | 'short_liabilities' | 'long_liabilities' | 'equity') =>
      sectionRows(sections.find((section) => section.key === key)!, key === 'equity' ? words.equitySection : words[key], words, byGroup);
    return [
      ...part('current_assets'),
      ...part('fixed_assets'),
      total(words.totalAssets, totals.assets),
      ...part('short_liabilities'),
      ...part('long_liabilities'),
      ...part('equity'),
      total(words.totalLiabilitiesAndEquity, totals.liabilitiesAndEquity),
    ];
  }
  if (statement.kind === 'cashflow') {
    const { sections, totals } = statement.data;
    return [
      total(words.opening, totals.opening),
      ...sections.flatMap((section) => sectionRows(section, words[section.key], words, false)),
      total(words.net, totals.net),
      total(words.closing, totals.closing),
    ];
  }
  return [];
}

const subtitleOf = (statement: StatementData, language: Language) => {
  const words = WORDS[language];
  if (statement.kind === 'balance') return words.asOn(day(statement.data.date, language));
  return words.range(day(statement.data.period.from, language), day(statement.data.period.to, language));
};

const compareTitle = (statement: StatementData, language: Language): string | null => {
  if (statement.kind === 'balance') return statement.data.compareDate ? day(statement.data.compareDate, language) : null;
  if (statement.kind === 'equity') return null;
  const compare = statement.data.compare;
  return compare ? `${day(compare.from, language)} – ${day(compare.to, language)}` : null;
};

const currentTitle = (statement: StatementData, language: Language) =>
  statement.kind === 'balance' ? day(statement.data.date, language) : statement.kind === 'equity' ? '' : `${day(statement.data.period.from, language)} – ${day(statement.data.period.to, language)}`;

export function statementSheet(statement: StatementData, language: Language): { basename: string; sheet: Sheet<Row> | Sheet<EquityChanges['rows'][number]> } {
  const words = WORDS[language];
  const name = words[statement.kind];
  const subtitle = subtitleOf(statement, language);
  if (statement.kind === 'equity') {
    const rows = [...statement.data.rows, { accountId: null, number: null, name: words.total, ...statement.data.total }];
    const columns: ExportColumn<(typeof rows)[number]>[] = [
      { header: words.number, value: (row) => row.number },
      { header: words.account, value: (row) => ('key' in row && row.key ? words[row.key] : row.name) },
      { header: words.start, kind: 'money', value: (row) => row.start },
      { header: words.increase, kind: 'money', value: (row) => row.increase },
      { header: words.decrease, kind: 'money', value: (row) => row.decrease },
      { header: words.end, kind: 'money', value: (row) => row.end },
    ];
    return { basename: `${name} ${statement.data.period.from} ${statement.data.period.to}`, sheet: { name, subtitle, columns, rows } };
  }
  const rows = rowsOf(statement, words, false);
  const compare = compareTitle(statement, language);
  const columns: ExportColumn<Row>[] = [
    { header: words.number, value: (row) => row.number },
    { header: words.account, value: (row) => row.label },
    { header: currentTitle(statement, language) || words.total, kind: 'money', value: (row) => row.amount },
    ...(compare ? [{ header: compare, kind: 'money' as const, value: (row: Row) => row.compare }] : []),
  ];
  const key = statement.kind === 'balance' ? statement.data.date : `${statement.data.period.from} ${statement.data.period.to}`;
  return { basename: `${name} ${key}`, sheet: { name, subtitle, columns, rows } };
}

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** The statement as an A4 page to print or save as PDF, on the printed finish of DESIGN.md. */
export function statementHtml(
  statement: StatementData,
  language: Language,
  finish: PrintFinish,
  business: { name: string; nui: string | null; address: string | null },
  today: string,
): string {
  const words = WORDS[language];
  const title = words[statement.kind];
  const eur = (amount: number | null) => (amount === null ? '' : escape(money(amount, language)));
  const official = finish === 'official';
  let head: string[];
  let body: string;
  if (statement.kind === 'equity') {
    head = [words.account, words.start, words.increase, words.decrease, words.end];
    const line = (label: string, row: { start: number; increase: number; decrease: number; end: number }, cls = '') =>
      `<tr${cls ? ` class="${cls}"` : ''}><td>${escape(label)}</td>${[row.start, row.increase, row.decrease, row.end].map((value) => `<td class="num">${eur(value)}</td>`).join('')}</tr>`;
    body =
      statement.data.rows.map((row) => line(`${official && row.number ? `${row.number} ` : ''}${row.key ? words[row.key] : row.name}`, row)).join('') +
      line(words.total, statement.data.total, 'total');
  } else {
    const compare = compareTitle(statement, language);
    head = [words.account, currentTitle(statement, language), ...(compare ? [compare] : [])];
    const rows = rowsOf(statement, words, !official);
    body = rows
      .map((row) => {
        if (row.style === 'heading' || row.style === 'group') return `<tr class="${row.style}"><td colspan="${head.length}">${escape(row.label)}</td></tr>`;
        const label = `${official && row.number ? `<span class="no">${escape(row.number)}</span>` : ''}${escape(row.label)}`;
        return `<tr class="${row.style}"><td>${label}</td><td class="num">${eur(row.amount)}</td>${compare ? `<td class="num">${eur(row.compare)}</td>` : ''}</tr>`;
      })
      .join('');
  }
  const balanced = statement.kind === 'equity' || statement.kind === 'income' || statement.data.balanced;
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(`${title} · ${subtitleOf(statement, language)}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600&family=Source+Serif+4:opsz,wght@8..60,500&display=swap" rel="stylesheet">
<style>
  :root { --ink: #141413; --ink-muted: #5e5d59; --hairline: #e0dbcf; --hairline-strong: #cbc3b3; --sunk: #f0eee6; --clay-text: #a8482a; }
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 400 9pt/1.4 'Hanken Grotesk', system-ui, sans-serif; font-variant-numeric: tabular-nums; padding: 10mm; }
  @media print { body { padding: 0; } }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; border-bottom: 3px double var(--ink); padding-bottom: 3mm; margin-bottom: 5mm; }
  h1 { font: 500 18pt/1.2 'Source Serif 4', Georgia, serif; margin: 0; }
  header p { margin: 0; color: var(--ink-muted); }
  .shop { text-align: right; }
  .shop strong { color: var(--ink); font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: right; font-weight: 600; vertical-align: bottom; border-bottom: 1px solid var(--hairline-strong); padding: 1.5mm 1.5mm; }
  th:first-child { text-align: left; }
  td { border-bottom: 1px solid var(--hairline); padding: 1.3mm 1.5mm; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; width: 32mm; }
  .no { display: inline-block; min-width: 12mm; color: var(--clay-text); }
  tr.heading td { font-weight: 600; border-bottom: 1px solid var(--ink); padding-top: 4mm; }
  tr.group td { color: var(--ink-muted); font-style: italic; }
  tr.subtotal td { font-weight: 600; background: var(--sunk); }
  tr.total td { font-weight: 600; border-top: 1px solid var(--ink); border-bottom: 3px double var(--ink); }
  .off { margin: 4mm 0; padding: 2mm 3mm; border: 1px solid var(--clay-text); color: var(--clay-text); }
  footer { margin-top: 8mm; color: var(--ink-muted); }
  .signs { display: flex; gap: 16mm; margin-top: 18mm; }
  .signs div { flex: 1; border-top: 1px solid var(--ink); padding-top: 1.5mm; }
</style>
</head>
<body>
<header>
  <div><h1>${escape(title)}</h1><p>${escape(subtitleOf(statement, language))}</p></div>
  <p class="shop"><strong>${escape(business.name)}</strong>${business.nui ? `<br>${escape(words.nui)} ${escape(business.nui)}` : ''}${!official && business.address ? `<br>${escape(business.address)}` : ''}</p>
</header>
${balanced ? '' : `<p class="off">${escape(words.unbalanced)}</p>`}
<table>
<thead><tr>${head.map((label) => `<th>${escape(label)}</th>`).join('')}</tr></thead>
<tbody>${body}</tbody>
</table>
<footer>
  <p>${escape(words.madeFrom(day(today, language)))}</p>
  ${official ? '' : `<div class="signs"><div>${escape(words.director)} · ${escape(words.signature)}</div><div>${escape(words.accountant)}</div></div>`}
</footer>
</body>
</html>`;
}
