import { type Language, LOCALE, money } from '../../i18n/language.js';
import type { Sheet } from '../../utils/spreadsheet.js';
import type { MonthDetailDto, PayslipData, PreviewLine } from './PayrollService.js';

const MONTHS: Record<Language, string[]> = {
  sq: ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const monthTitle = (month: string, language: Language) => `${MONTHS[language][Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

const WORDS = {
  sq: {
    payslip: 'Lista e pagesës',
    employee: 'Punëtori',
    personalNumber: 'Nr. personal',
    jobTitle: 'Pozita',
    startedOn: 'Fillimi i punës',
    bankAccount: 'Llog. bankare',
    gross: 'Paga bruto',
    employeePension: 'Kontributi pensional nga punëtori',
    employerPension: 'Kontributi pensional nga punëdhënësi',
    taxable: 'Paga e tatueshme',
    tax: 'Tatimi në paga',
    net: 'Paga neto',
    secondary: 'Punë sekondare (10% e sheshtë)',
    nonResident: 'Person jorezident (pa kontribut pensional)',
    band: (rate: number, base: string) => `${rate}% mbi ${base}`,
    paidOn: 'Paguar më',
    notPaid: 'Ende pa paguar',
    leave: 'Pushimi vjetor',
    leaveLine: (balance: number, taken: number, yearly: number) => `${balance} ditë të mbetura · ${taken} të marra · ${yearly} në vit`,
    employerCost: 'Kosto e punëdhënësit',
    reason: 'Ndryshim këtë muaj',
    nui: 'NUI',
    // The declaration
    declaration: 'Deklarimi i pagave',
    no: 'Nr',
    name: 'Emri dhe mbiemri',
    secondaryShort: 'Sekondar',
    nonResidentShort: 'Jorezident',
    yes: 'Po',
  },
  en: {
    payslip: 'Payslip',
    employee: 'Employee',
    personalNumber: 'Personal number',
    jobTitle: 'Job',
    startedOn: 'Started',
    bankAccount: 'Bank account',
    gross: 'Gross pay',
    employeePension: 'Pension from the employee',
    employerPension: 'Pension from the employer',
    taxable: 'Taxable pay',
    tax: 'Wage tax',
    net: 'Net pay',
    secondary: 'Second job (flat 10%)',
    nonResident: 'Not resident (no pension)',
    band: (rate: number, base: string) => `${rate}% on ${base}`,
    paidOn: 'Paid on',
    notPaid: 'Not paid yet',
    leave: 'Annual leave',
    leaveLine: (balance: number, taken: number, yearly: number) => `${balance} days left · ${taken} taken · ${yearly} a year`,
    employerCost: 'Cost to the employer',
    reason: 'Changed this month',
    nui: 'NUI',
    declaration: 'Payroll declaration',
    no: 'No',
    name: 'Name',
    secondaryShort: 'Second job',
    nonResidentShort: 'Not resident',
    yes: 'Yes',
  },
} as const;

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** One person's payslip as an A4 page to print or save as PDF, on the printed finish of DESIGN.md. */
export function payslipHtml(data: PayslipData, language: Language): string {
  const w = WORDS[language];
  const eur = (amount: number) => escape(money(amount, language));
  const day = (value: string) =>
    new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : LOCALE[language], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
  const { line, employee } = data;
  const title = `${w.payslip} · ${monthTitle(data.month, language)}`;
  const facts: Array<[string, string | null]> = [
    [w.personalNumber, employee.personalNumber],
    [w.jobTitle, employee.jobTitle],
    [w.startedOn, day(employee.startedOn)],
    [w.bankAccount, employee.bankAccount],
  ];
  const rows: Array<{ label: string; amount: string; detail?: string; strong?: boolean }> = [
    { label: w.gross, amount: eur(line.gross), detail: line.changedReason ? `${w.reason}: ${escape(line.changedReason)}` : undefined },
    { label: w.employeePension, amount: `− ${eur(line.employeePension)}`, detail: line.nonResident ? escape(w.nonResident) : `${line.employeeRate}%` },
    { label: w.taxable, amount: eur(line.taxable) },
    {
      label: w.tax,
      amount: `− ${eur(line.tax)}`,
      detail: line.secondary ? escape(w.secondary) : line.taxParts.map((part) => escape(w.band(part.rate, money(part.base, language)))).join(' · '),
    },
    { label: w.net, amount: eur(line.net), strong: true },
  ];
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(`${title} · ${employee.name}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600&family=Source+Serif+4:opsz,wght@8..60,500&display=swap" rel="stylesheet">
<style>
  :root { --ink: #141413; --ink-muted: #5e5d59; --hairline: #e0dbcf; --hairline-strong: #cbc3b3; --sunk: #f0eee6; }
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 400 10pt/1.45 'Hanken Grotesk', system-ui, sans-serif; font-variant-numeric: tabular-nums; padding: 12mm; max-width: 190mm; }
  @media print { body { padding: 0; } }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 8mm; border-bottom: 3px double var(--ink); padding-bottom: 4mm; margin-bottom: 6mm; }
  h1 { font: 500 18pt/1.2 'Source Serif 4', Georgia, serif; margin: 0; }
  header p, .muted { margin: 0; color: var(--ink-muted); }
  h2 { font: 500 13pt/1.3 'Source Serif 4', Georgia, serif; margin: 0 0 2mm; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 1mm 6mm; margin: 0 0 6mm; }
  dt { color: var(--ink-muted); }
  dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
  td { border-bottom: 1px solid var(--hairline); padding: 2mm 1mm; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; }
  td small { display: block; color: var(--ink-muted); font-size: 8.5pt; }
  tr.strong td { font-weight: 600; border-top: 1px solid var(--ink); border-bottom: 0; font-size: 11.5pt; }
  footer { border-top: 1px solid var(--hairline-strong); padding-top: 3mm; display: grid; gap: 1.5mm; }
</style>
</head>
<body>
<header>
  <div><h1>${escape(w.payslip)}</h1><p>${escape(monthTitle(data.month, language))}</p></div>
  <p>${escape(data.business.name)}${data.business.nui ? ` · ${escape(w.nui)} ${escape(data.business.nui)}` : ''}</p>
</header>
<h2>${escape(employee.name)}</h2>
<dl>${facts
    .filter(([, value]) => value)
    .map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value!)}</dd>`)
    .join('')}</dl>
<table>
<tbody>${rows
    .map((row) => `<tr${row.strong ? ' class="strong"' : ''}><td>${escape(row.label)}${row.detail ? `<small>${row.detail}</small>` : ''}</td><td class="num">${row.amount}</td></tr>`)
    .join('')}</tbody>
</table>
<footer>
  <p>${escape(data.paidOn ? `${w.paidOn} ${day(data.paidOn)}` : w.notPaid)}</p>
  <p class="muted">${escape(w.employerPension)}: ${eur(line.employerPension)} (${line.employerRate}%) · ${escape(w.employerCost)}: ${eur(line.cost)}</p>
  <p class="muted">${escape(w.leave)}: ${escape(w.leaveLine(data.leave.balance, data.leave.taken, data.leave.yearly))}</p>
</footer>
</body>
</html>`;
}

/**
 * The month's payroll declaration, one row per person, for ATK's EDI.
 *
 * Default until ATK's own EDI payroll sample file is in hand (handoff.md,
 * "Files wanted"): TREFIN's monthly payroll columns (Paga Mujore [PM]) in
 * their order, amounts as plain numbers with a decimal point. Change
 * DECLARATION_FORMAT when the sample arrives.
 */
export const DECLARATION_FORMAT = {
  amount: (value: number) => Math.round(value * 100) / 100,
  yesNo: (value: boolean) => (value ? 'Po' : 'Jo'),
};

export function declarationSheet(detail: MonthDetailDto, language: Language): { basename: string; sheet: Sheet<PreviewLine & { no: number }> } {
  const w = WORDS[language];
  const rows = detail.lines.map((line, index) => ({ ...line, no: index + 1 }));
  return {
    basename: `${WORDS.sq.declaration} ${detail.month.slice(0, 7)}`,
    sheet: {
      name: w.declaration,
      subtitle: monthTitle(detail.month, language),
      columns: [
        { header: w.no, value: (row) => row.no, kind: 'number' },
        { header: w.name, value: (row) => row.name },
        { header: w.personalNumber, value: (row) => row.personalNumber ?? '' },
        { header: w.secondaryShort, value: (row) => DECLARATION_FORMAT.yesNo(row.secondary) },
        { header: w.nonResidentShort, value: (row) => DECLARATION_FORMAT.yesNo(row.nonResident) },
        { header: w.gross, value: (row) => DECLARATION_FORMAT.amount(row.gross), kind: 'money', total: true },
        { header: w.employerPension, value: (row) => DECLARATION_FORMAT.amount(row.employerPension), kind: 'money', total: true },
        { header: w.employeePension, value: (row) => DECLARATION_FORMAT.amount(row.employeePension), kind: 'money', total: true },
        { header: w.taxable, value: (row) => DECLARATION_FORMAT.amount(row.taxable), kind: 'money', total: true },
        { header: w.tax, value: (row) => DECLARATION_FORMAT.amount(row.tax), kind: 'money', total: true },
        { header: w.net, value: (row) => DECLARATION_FORMAT.amount(row.net), kind: 'money', total: true },
      ],
      rows,
      totals: { inCsv: false },
    },
  };
}
