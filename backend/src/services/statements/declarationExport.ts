import { type Language, LOCALE, money } from '../../i18n/language.js';
import type { ExportColumn, Sheet } from '../../utils/spreadsheet.js';
import type { AdjustmentKey, CostKey, DeclarationDto, IncomeKey } from './DeclarationService.js';

/**
 * The yearly declaration as downloads: an Excel workbook and an A4 page to
 * print or save as PDF, with the business details and room to sign. The
 * layout is 4VD's own (DECLARATION_LAYOUT in DeclarationService.ts) until
 * ATK's form is known.
 */

const WORDS = {
  en: {
    CD: 'Corporate income tax declaration (CD)',
    PD: 'Personal income tax declaration (PD)',
    year: (year: number) => `Year ${year}`,
    income: 'Income',
    costs: 'Costs',
    sales: 'Sales',
    financial_income: 'Financial income',
    other_income: 'Other income',
    carwash_takings: 'Carwash takings (outside the books)',
    cost_of_goods: 'Cost of goods sold',
    wages: 'Wages and pension',
    depreciation: 'Depreciation',
    rent: 'Rent',
    running: 'Other running costs',
    financial_costs: 'Financial costs',
    other_costs: 'Other costs',
    carwash_costs: 'Carwash wages and bills (outside the books)',
    totalIncome: 'Total income',
    totalCosts: 'Total costs',
    profitBeforeBooks: 'Profit before the books started (typed)',
    bookProfit: 'Book profit',
    adjustments: 'Added back (not deductible)',
    representation: 'Representation above the limit',
    donations: 'Gifts and donations above the limit',
    fines: 'Fines and penalties',
    other: 'Other',
    adjustedProfit: 'Profit after adjustments',
    losses: 'Losses carried forward',
    lossOf: (year: number) => `Loss of ${year}`,
    taxable: 'Taxable profit',
    band: (from: string, to: string | null, rate: number) => (to ? `${rate}% on ${from} to ${to}` : `${rate}% above ${from}`),
    tax: 'Tax',
    instalments: 'Instalments paid for the year',
    quarter: (quarter: number) => `Q${quarter}`,
    rest: 'Paid with the declaration',
    left: 'Left to pay',
    overpaid: 'Paid too much',
    due: (day: string) => `Due by ${day}`,
    filedOn: (day: string) => `Filed on ${day}`,
    line: 'Line',
    amount: 'Amount',
    nui: 'NUI',
    madeFrom: (day: string) => `Prepared from 4VD's books on ${day}. Layout by 4VD; type the figures into ATK's form.`,
    signature: 'Signature and stamp',
    accountant: 'Accountant',
    director: 'Director',
    owner: 'Owner',
  },
  sq: {
    CD: 'Deklarata vjetore e tatimit në të ardhurat e korporatave (CD)',
    PD: 'Deklarata vjetore e tatimit në të ardhurat personale (PD)',
    year: (year: number) => `Viti ${year}`,
    income: 'Të ardhurat',
    costs: 'Shpenzimet',
    sales: 'Shitjet',
    financial_income: 'Të ardhurat financiare',
    other_income: 'Të ardhurat tjera',
    carwash_takings: 'Të hyrat e lavazhit (jashtë librave)',
    cost_of_goods: 'Kostoja e mallit të shitur',
    wages: 'Pagat dhe pensioni',
    depreciation: 'Zhvlerësimi',
    rent: 'Qiraja',
    running: 'Shpenzimet tjera operative',
    financial_costs: 'Shpenzimet financiare',
    other_costs: 'Shpenzimet tjera',
    carwash_costs: 'Pagat dhe faturat e lavazhit (jashtë librave)',
    totalIncome: 'Gjithsej të ardhurat',
    totalCosts: 'Gjithsej shpenzimet',
    profitBeforeBooks: 'Fitimi para fillimit të librave (i shkruar)',
    bookProfit: 'Fitimi sipas librave',
    adjustments: 'Të shtuara (jo të zbritshme)',
    representation: 'Reprezentacioni mbi kufirin',
    donations: 'Dhuratat dhe donacionet mbi kufirin',
    fines: 'Gjobat dhe ndëshkimet',
    other: 'Tjera',
    adjustedProfit: 'Fitimi pas rregullimeve',
    losses: 'Humbjet e bartura',
    lossOf: (year: number) => `Humbja e ${year}`,
    taxable: 'Fitimi i tatueshëm',
    band: (from: string, to: string | null, rate: number) => (to ? `${rate}% nga ${from} deri ${to}` : `${rate}% mbi ${from}`),
    tax: 'Tatimi',
    instalments: 'Këstet e paguara për vitin',
    quarter: (quarter: number) => `TM${quarter}`,
    rest: 'Paguar me deklaratën',
    left: 'Mbetet për t’u paguar',
    overpaid: 'Paguar më shumë',
    due: (day: string) => `Afati ${day}`,
    filedOn: (day: string) => `Dorëzuar më ${day}`,
    line: 'Rreshti',
    amount: 'Shuma',
    nui: 'NUI',
    madeFrom: (day: string) => `Përgatitur nga librat e 4VD më ${day}. Forma e 4VD; shënoni shifrat në formularin e ATK-së.`,
    signature: 'Nënshkrimi dhe vula',
    accountant: 'Kontabilisti',
    director: 'Drejtori',
    owner: 'Pronari',
  },
};

const day = (value: string, language: Language) =>
  new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : LOCALE[language], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));

interface Row {
  label: string;
  amount: number | null;
  style: 'heading' | 'line' | 'subtotal' | 'total';
}

function rowsOf(data: DeclarationDto, language: Language): Row[] {
  const w = WORDS[language];
  const rows: Row[] = [{ label: w.income, amount: null, style: 'heading' }];
  for (const line of data.income.lines) if (line.amount !== 0 || line.key === 'sales') rows.push({ label: w[line.key as IncomeKey], amount: line.amount, style: 'line' });
  rows.push({ label: w.totalIncome, amount: data.income.total, style: 'subtotal' }, { label: w.costs, amount: null, style: 'heading' });
  for (const line of data.costs.lines) if (line.amount !== 0) rows.push({ label: w[line.key as CostKey], amount: line.amount, style: 'line' });
  rows.push({ label: w.totalCosts, amount: data.costs.total, style: 'subtotal' });
  if (data.profitBeforeBooks !== 0) rows.push({ label: w.profitBeforeBooks, amount: data.profitBeforeBooks, style: 'line' });
  rows.push({ label: w.bookProfit, amount: data.bookProfit, style: 'total' }, { label: w.adjustments, amount: null, style: 'heading' });
  for (const line of data.adjustments) {
    if (line.amount === 0 && line.key !== 'representation') continue;
    rows.push({ label: line.key === 'other' ? line.label ?? w.other : w[line.key as Exclude<AdjustmentKey, 'other'>], amount: line.amount, style: 'line' });
  }
  rows.push({ label: w.adjustedProfit, amount: data.adjustedProfit, style: 'subtotal' });
  const used = data.losses.filter((loss) => loss.used > 0);
  if (used.length > 0) {
    rows.push({ label: w.losses, amount: null, style: 'heading' });
    for (const loss of used) rows.push({ label: w.lossOf(loss.year), amount: -loss.used, style: 'line' });
  }
  rows.push({ label: w.taxable, amount: data.taxable, style: 'total' }, { label: w.tax, amount: null, style: 'heading' });
  for (const part of data.taxParts) {
    if (data.form === 'PD' || part.base > 0) rows.push({ label: w.band(money(part.from, language), part.to === null ? null : money(part.to, language), part.rate), amount: part.tax, style: 'line' });
  }
  rows.push({ label: w.tax, amount: data.tax, style: 'subtotal' });
  for (const item of data.instalments) rows.push({ label: `${w.instalments}: ${w.quarter(item.quarter)}`, amount: -item.amount, style: 'line' });
  if (data.restPayment) rows.push({ label: w.rest, amount: -data.restPayment.amount, style: 'line' });
  rows.push({ label: data.left < 0 ? w.overpaid : w.left, amount: Math.abs(data.left), style: 'total' });
  return rows;
}

export function declarationSheet(data: DeclarationDto, language: Language): { basename: string; sheet: Sheet<Row> } {
  const w = WORDS[language];
  const columns: ExportColumn<Row>[] = [
    { header: w.line, value: (row) => row.label },
    { header: w.amount, kind: 'money', value: (row) => row.amount },
  ];
  return { basename: `${data.form} ${data.year}`, sheet: { name: data.form, subtitle: `${w[data.form]} · ${w.year(data.year)}`, columns, rows: rowsOf(data, language) } };
}

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** The declaration as an A4 page to print or save as PDF, on the printed finish of DESIGN.md. */
export function declarationHtml(data: DeclarationDto, language: Language, business: { name: string; nui: string | null; address: string | null }, today: string): string {
  const w = WORDS[language];
  const title = w[data.form];
  const eur = (amount: number | null) => (amount === null ? '' : escape(money(amount, language)));
  const body = rowsOf(data, language)
    .map((row) => (row.style === 'heading' ? `<tr class="heading"><td colspan="2">${escape(row.label)}</td></tr>` : `<tr class="${row.style}"><td>${escape(row.label)}</td><td class="num">${eur(row.amount)}</td></tr>`))
    .join('');
  const status = data.filed ? w.filedOn(day(data.filed.on, language)) : w.due(day(data.due, language));
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(`${data.form} ${data.year} · ${business.name}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600&family=Source+Serif+4:opsz,wght@8..60,500&display=swap" rel="stylesheet">
<style>
  :root { --ink: #141413; --ink-muted: #5e5d59; --hairline: #e0dbcf; --hairline-strong: #cbc3b3; --sunk: #f0eee6; }
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 400 9.5pt/1.45 'Hanken Grotesk', system-ui, sans-serif; font-variant-numeric: tabular-nums; padding: 10mm; }
  @media print { body { padding: 0; } }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; border-bottom: 3px double var(--ink); padding-bottom: 3mm; margin-bottom: 5mm; }
  h1 { font: 500 16pt/1.2 'Source Serif 4', Georgia, serif; margin: 0; }
  header p { margin: 0; color: var(--ink-muted); }
  .shop { text-align: right; }
  .shop strong { color: var(--ink); font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  td { border-bottom: 1px solid var(--hairline); padding: 1.3mm 1.5mm; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; width: 36mm; }
  tr.heading td { font-weight: 600; border-bottom: 1px solid var(--ink); padding-top: 4mm; }
  tr.subtotal td { font-weight: 600; background: var(--sunk); }
  tr.total td { font-weight: 600; border-top: 1px solid var(--ink); border-bottom: 3px double var(--ink); }
  footer { margin-top: 8mm; color: var(--ink-muted); }
  .signs { display: flex; gap: 16mm; margin-top: 18mm; }
  .signs div { flex: 1; border-top: 1px solid var(--ink); padding-top: 1.5mm; }
</style>
</head>
<body>
<header>
  <div><h1>${escape(title)}</h1><p>${escape(w.year(data.year))} · ${escape(status)}</p></div>
  <p class="shop"><strong>${escape(business.name)}</strong>${business.nui ? `<br>${escape(w.nui)} ${escape(business.nui)}` : ''}${business.address ? `<br>${escape(business.address)}` : ''}</p>
</header>
<table>
<tbody>${body}</tbody>
</table>
<footer>
  <p>${escape(w.madeFrom(day(today, language)))}</p>
  <div class="signs"><div>${escape(data.form === 'PD' ? w.owner : w.director)} · ${escape(w.signature)}</div><div>${escape(w.accountant)}</div></div>
</footer>
</body>
</html>`;
}
