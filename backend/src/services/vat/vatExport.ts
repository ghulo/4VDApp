import { type Language, LOCALE, money } from '../../i18n/language.js';
import { roundMoney } from '../../utils/money.js';
import type { ExportColumn, Sheet } from '../../utils/spreadsheet.js';
import { WITHHOLDING_RATES } from '../../constants/bills.js';
import type { VatYearRow, WithholdingRow } from './VatService.js';
import { CHARGED_ROWS, CLAIM_ROWS, type VatItem, type VatRowDef } from './vatReturn.js';

/**
 * The VAT month's downloads: the sales book and the purchase book (Excel, a
 * page to print or save as PDF, and the file for ATK's EDI upload), the tax
 * held back and the year's overview. Words are Albanian, as ATK reads them, or
 * English.
 */

export type BookKind = 'sales' | 'purchases';

/** What each box of the VAT return is, as the form words it (Albanian) and in plain English. */
export const BOX_LABELS: Record<Language, Record<number, string>> = {
  sq: {
    9: 'Shitjet e liruara pa të drejtë kreditimi',
    10: 'Shitjet e liruara me të drejtë kreditimi',
    11: 'Eksportet',
    12: 'Shitjet e tatueshme 18%',
    13: 'TVSH 18%',
    14: 'Shitjet e tatueshme 8%',
    15: 'TVSH 8%',
    16: 'Nota debitore e lëshuar, nota kreditore e pranuar 18%',
    17: 'TVSH 18%',
    18: 'Nota debitore e lëshuar, nota kreditore e pranuar 8%',
    19: 'TVSH 8%',
    20: 'Fatura e borxhit të keq e pranuar 18%',
    21: 'TVSH 18%',
    22: 'Fatura e borxhit të keq e pranuar 8%',
    23: 'TVSH 8%',
    24: 'Rregullimet për të rritur TVSH-në 18%',
    25: 'TVSH 18%',
    26: 'Rregullimet për të rritur TVSH-në 8%',
    27: 'TVSH 8%',
    28: 'Blerjet me ngarkesë të kundërt',
    29: 'TVSH me ngarkesë të kundërt',
    31: 'Blerjet dhe importet pa TVSH',
    32: 'Blerjet dhe importet investive pa TVSH',
    33: 'Blerjet dhe importet me TVSH jo të zbritshme',
    34: 'Blerjet dhe importet investive me TVSH jo të zbritshme',
    35: 'Importet 18%',
    36: 'TVSH 18%',
    37: 'Importet 8%',
    38: 'TVSH 8%',
    39: 'Importet investive 18%',
    40: 'TVSH 18%',
    41: 'Importet investive 8%',
    42: 'TVSH 8%',
    43: 'Blerjet vendore 18%',
    44: 'TVSH 18%',
    45: 'Blerjet vendore 8%',
    46: 'TVSH 8%',
    47: 'Blerjet investive vendore 18%',
    48: 'TVSH 18%',
    49: 'Blerjet investive vendore 8%',
    50: 'TVSH 8%',
    51: 'Blerjet nga fermerët',
    52: 'TVSH 8%',
    53: 'Nota debitore e pranuar, nota kreditore e lëshuar 18%',
    54: 'TVSH 18%',
    55: 'Nota debitore e pranuar, nota kreditore e lëshuar 8%',
    56: 'TVSH 8%',
    57: 'Fatura e borxhit të keq e lëshuar 18%',
    58: 'TVSH 18%',
    59: 'Fatura e borxhit të keq e lëshuar 8%',
    60: 'TVSH 8%',
    61: 'Rregullimet për të ulur TVSH-në 18%',
    62: 'TVSH 18%',
    63: 'Rregullimet për të ulur TVSH-në 8%',
    64: 'TVSH 8%',
    65: 'E drejta e kreditimit nga ngarkesa e kundërt',
    66: 'TVSH 18%',
  },
  en: {
    9: 'Exempt sales, no right to claim',
    10: 'Exempt sales, with right to claim (0%)',
    11: 'Exports',
    12: 'Sales at 18%',
    13: 'VAT 18%',
    14: 'Sales at 8%',
    15: 'VAT 8%',
    16: 'Debit notes issued, credit notes received, 18%',
    17: 'VAT 18%',
    18: 'Debit notes issued, credit notes received, 8%',
    19: 'VAT 8%',
    20: 'Bad debt recovered, 18%',
    21: 'VAT 18%',
    22: 'Bad debt recovered, 8%',
    23: 'VAT 8%',
    24: 'Adjustments raising VAT, 18%',
    25: 'VAT 18%',
    26: 'Adjustments raising VAT, 8%',
    27: 'VAT 8%',
    28: 'Purchases under reverse charge',
    29: 'Reverse-charge VAT',
    31: 'Purchases and imports without VAT',
    32: 'Equipment bought or imported without VAT',
    33: 'Purchases with VAT you cannot claim',
    34: 'Equipment with VAT you cannot claim',
    35: 'Imports at 18%',
    36: 'VAT 18%',
    37: 'Imports at 8%',
    38: 'VAT 8%',
    39: 'Equipment imports at 18%',
    40: 'VAT 18%',
    41: 'Equipment imports at 8%',
    42: 'VAT 8%',
    43: 'Purchases in Kosovo at 18%',
    44: 'VAT 18%',
    45: 'Purchases in Kosovo at 8%',
    46: 'VAT 8%',
    47: 'Equipment bought in Kosovo at 18%',
    48: 'VAT 18%',
    49: 'Equipment bought in Kosovo at 8%',
    50: 'VAT 8%',
    51: 'Purchases from farmers',
    52: 'VAT 8%',
    53: 'Debit notes received, credit notes issued, 18%',
    54: 'VAT 18%',
    55: 'Debit notes received, credit notes issued, 8%',
    56: 'VAT 8%',
    57: 'Bad debt written off, 18%',
    58: 'VAT 18%',
    59: 'Bad debt written off, 8%',
    60: 'VAT 8%',
    61: 'Adjustments lowering VAT, 18%',
    62: 'VAT 18%',
    63: 'Adjustments lowering VAT, 8%',
    64: 'VAT 8%',
    65: 'VAT claimed on reverse charge',
    66: 'VAT 18%',
  },
};

const WORDS = {
  sq: {
    salesBook: 'Libri i shitjes',
    purchaseBook: 'Libri i blerjes',
    withholding: 'Tatimi në burim',
    year: 'Pasqyra e TVSH-së',
    no: 'Nr.',
    date: 'Data',
    number: 'Nr. i faturës',
    customer: 'Klienti',
    supplier: 'Furnitori',
    nui: 'NUI',
    salesTotal: 'Shitjet totale',
    purchasesTotal: 'Blerjet totale pa TVSH',
    vat18: 'Totali i TVSH-së 18%',
    vat8: 'Totali i TVSH-së 8%',
    vatTotal: 'Totali i TVSH-së',
    tillDay: (count: number) => `Shitje me kupona (${count})`,
    tillNumber: 'Kuponat e ditës',
    late: (month: string) => `faturë e ${month}`,
    type: 'Lloji',
    rate: 'Norma',
    gross: 'Shuma bruto',
    withheld: 'Tatimi i mbajtur',
    month: 'Muaji',
    status: 'Statusi',
    sales: 'Shitjet',
    purchases: 'Blerjet',
    equipment: 'Investimet',
    charged: 'TVSH e llogaritur',
    claimable: 'TVSH e zbritshme',
    difference: 'Diferenca',
    carriedIn: 'Teprica e bartur',
    carriedOut: 'Kreditimi për muajin pasues',
    toPay: 'Për të paguar',
    filed: 'Deklaruar',
    open: 'Hapur',
    future: '',
    withholdingTypes: { interest: 'Interesi', royalties: 'Të drejtat pronësore', lottery: 'Fitimet nga lotaria', rent: 'Qiraja', entertainers: 'Artistët dhe sportistët', nonresident_services: 'Shërbime nga jorezidentët', special: 'Kategoritë e veçanta' } as Record<string, string>,
    business: 'Biznesi',
    period: 'Periudha',
    total: 'Totali',
    empty: 'Asnjë dokument këtë muaj.',
  },
  en: {
    salesBook: 'Sales book',
    purchaseBook: 'Purchase book',
    withholding: 'Tax held back',
    year: 'VAT year',
    no: 'No.',
    date: 'Date',
    number: 'Number',
    customer: 'Customer',
    supplier: 'Supplier',
    nui: 'NUI',
    salesTotal: 'Total sales',
    purchasesTotal: 'Total purchases before VAT',
    vat18: 'VAT 18% total',
    vat8: 'VAT 8% total',
    vatTotal: 'VAT total',
    tillDay: (count: number) => `Till sales (${count})`,
    tillNumber: 'Till receipts of the day',
    late: (month: string) => `bill from ${month}`,
    type: 'Type',
    rate: 'Rate',
    gross: 'Gross',
    withheld: 'Tax held back',
    month: 'Month',
    status: 'Status',
    sales: 'Sales',
    purchases: 'Purchases',
    equipment: 'Equipment',
    charged: 'VAT charged',
    claimable: 'VAT to claim',
    difference: 'Difference',
    carriedIn: 'Credit carried in',
    carriedOut: 'Credit carried on',
    toPay: 'To pay',
    filed: 'Filed',
    open: 'Open',
    future: '',
    withholdingTypes: { interest: 'Interest', royalties: 'Royalties', lottery: 'Lottery winnings', rent: 'Rent', entertainers: 'Entertainers and sportspeople', nonresident_services: 'Services from non-residents', special: 'Special categories' } as Record<string, string>,
    business: 'Business',
    period: 'Period',
    total: 'Total',
    empty: 'No documents this month.',
  },
};

const MONTHS: Record<Language, string[]> = {
  sq: ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
/** "2026-09" → "September 2026". */
export const monthTitle = (month: string, language: Language) => `${MONTHS[language][Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** One book row: a document with its box amounts. */
export interface BookRow {
  no: number;
  item: VatItem;
}

const ROWS: Record<BookKind, VatRowDef[]> = { sales: CHARGED_ROWS, purchases: CLAIM_ROWS };
const VAT_18: Record<BookKind, number[]> = { sales: [13, 17, 21, 25, 29], purchases: [36, 40, 44, 54, 58, 62, 66] };
const VAT_8: Record<BookKind, number[]> = { sales: [15, 19, 23, 27], purchases: [38, 42, 46, 50, 52, 56, 60, 64] };

/** The book's box columns, in the form's order: each line's base, then its VAT. */
export const bookBoxes = (kind: BookKind) => ROWS[kind].flatMap((row) => [row.base, ...(row.vat ? [row.vat] : [])]);

const sumBoxes = (item: VatItem, boxes: number[]) => roundMoney(boxes.reduce((sum, box) => sum + (item.boxes[box] ?? 0), 0));

/** The documents that belong in a book: anything with an amount in its boxes. */
export function bookRows(kind: BookKind, items: VatItem[]): BookRow[] {
  const boxes = bookBoxes(kind);
  return items.filter((item) => boxes.some((box) => (item.boxes[box] ?? 0) !== 0)).map((item, index) => ({ no: index + 1, item }));
}

/** Box columns with something in them; all of them when asked. */
export function visibleBoxes(kind: BookKind, rows: BookRow[], all: boolean): number[] {
  const boxes = bookBoxes(kind);
  return all ? boxes : boxes.filter((box) => rows.some((row) => (row.item.boxes[box] ?? 0) !== 0));
}

function party(row: BookRow, language: Language): string {
  const words = WORDS[language];
  if (row.item.kind === 'till_day') return words.tillDay(row.item.count ?? 0);
  return row.item.party ?? '';
}

function number(row: BookRow, language: Language): string {
  const words = WORDS[language];
  if (row.item.kind === 'till_day') return words.tillNumber;
  const late = row.item.lateFrom ? ` (${words.late(monthTitle(row.item.lateFrom, language))})` : '';
  return `${row.item.number ?? ''}${late}`;
}

/** The sales total (bases and VAT) or the purchases total before VAT. */
function rowTotal(kind: BookKind, row: BookRow): number {
  const bases = ROWS[kind].map((def) => def.base);
  const vat = ROWS[kind].flatMap((def) => (def.vat ? [def.vat] : []));
  return kind === 'sales' ? roundMoney(sumBoxes(row.item, bases) + sumBoxes(row.item, vat)) : sumBoxes(row.item, bases);
}

export function bookSheet(kind: BookKind, items: VatItem[], month: string, language: Language, all: boolean): { basename: string; sheet: Sheet<BookRow> } {
  const words = WORDS[language];
  const rows = bookRows(kind, items);
  const boxes = visibleBoxes(kind, rows, all);
  const columns: ExportColumn<BookRow>[] = [
    { header: words.no, value: (row) => row.no, kind: 'number' },
    { header: words.date, value: (row) => row.item.date, kind: 'date' },
    { header: words.number, value: (row) => number(row, language) },
    { header: kind === 'sales' ? words.customer : words.supplier, value: (row) => party(row, language) },
    { header: words.nui, value: (row) => row.item.nui ?? '' },
    { header: kind === 'sales' ? words.salesTotal : words.purchasesTotal, value: (row) => rowTotal(kind, row), kind: 'money', total: true },
    ...boxes.map(
      (box): ExportColumn<BookRow> => ({ header: `[${box}] ${BOX_LABELS[language][box]}`, value: (row) => row.item.boxes[box] ?? 0, kind: 'money', total: true }),
    ),
    { header: words.vat18, value: (row) => sumBoxes(row.item, VAT_18[kind]), kind: 'money', total: true },
    { header: words.vat8, value: (row) => sumBoxes(row.item, VAT_8[kind]), kind: 'money', total: true },
  ];
  const name = kind === 'sales' ? words.salesBook : words.purchaseBook;
  return {
    basename: `${name} ${month}`,
    sheet: { name, subtitle: monthTitle(month, language), columns, rows, totals: { inCsv: false } },
  };
}

/**
 * The book as ATK's EDI "Ngarko Librin" upload expects it.
 *
 * COLUMN MAP — A BEST GUESS until the accountant downloads ATK's sample file
 * from EDI ("Ngarko Librin" → download the sample) and sends it (handoff.md).
 * When it comes, change only this map: the header text, the order, the date
 * format and the decimal sign. Everything else reads the same items.
 */
export const EDI_FORMAT = {
  /** The date as EDI writes it. */
  date: (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`,
  /** Amounts as plain numbers with a decimal point (a number, so a minus sign is not read as a formula). */
  amount: (value: number) => roundMoney(value),
  /** The first columns, before one column per box. */
  head: {
    sales: ['Nr', 'Data', 'Nr. i faturës', 'Emri i blerësit', 'NUI i blerësit'],
    purchases: ['Nr', 'Data', 'Nr. i faturës', 'Emri i shitësit', 'NUI i shitësit'],
  },
  /** Each box column's header: the box number in brackets. Every box is written, empty or not. */
  box: (box: number) => `[${box}]`,
};

export function ediBook(kind: BookKind, items: VatItem[]): { basename: string; columns: Array<{ header: string; value: (row: BookRow) => string | number }>; rows: BookRow[] } {
  const rows = bookRows(kind, items);
  const columns: Array<{ header: string; value: (row: BookRow) => string | number }> = [
    { header: EDI_FORMAT.head[kind][0]!, value: (row) => row.no },
    { header: EDI_FORMAT.head[kind][1]!, value: (row) => EDI_FORMAT.date(row.item.date) },
    { header: EDI_FORMAT.head[kind][2]!, value: (row) => (row.item.kind === 'till_day' ? `KUPONAT ${row.item.date}` : (row.item.number ?? '')) },
    { header: EDI_FORMAT.head[kind][3]!, value: (row) => (row.item.kind === 'till_day' ? 'Shitje me kupona' : (row.item.party ?? '')) },
    { header: EDI_FORMAT.head[kind][4]!, value: (row) => row.item.nui ?? '' },
    ...bookBoxes(kind).map((box) => ({ header: EDI_FORMAT.box(box), value: (row: BookRow) => EDI_FORMAT.amount(row.item.boxes[box] ?? 0) })),
  ];
  return { basename: `EDI ${kind === 'sales' ? 'Libri i shitjes' : 'Libri i blerjes'}`, columns, rows };
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** The book as a landscape page to print or save as PDF, on the printed finish of DESIGN.md. */
export function bookHtml(kind: BookKind, items: VatItem[], month: string, language: Language, all: boolean, business: { name: string; nui: string | null }): string {
  const words = WORDS[language];
  const rows = bookRows(kind, items);
  const boxes = visibleBoxes(kind, rows, all);
  const eur = (amount: number) => (amount === 0 ? '' : escape(money(amount, language)));
  const day = (value: string) =>
    new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : LOCALE[language], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
  const title = kind === 'sales' ? words.salesBook : words.purchaseBook;
  const amounts = (row: BookRow) => [rowTotal(kind, row), ...boxes.map((box) => row.item.boxes[box] ?? 0), sumBoxes(row.item, VAT_18[kind]), sumBoxes(row.item, VAT_8[kind])];
  const totals = rows.reduce<number[]>((sum, row) => amounts(row).map((value, index) => roundMoney((sum[index] ?? 0) + value)), []);
  const head = [
    words.no,
    words.date,
    words.number,
    kind === 'sales' ? words.customer : words.supplier,
    words.nui,
    kind === 'sales' ? words.salesTotal : words.purchasesTotal,
  ];
  const body =
    rows.length === 0
      ? `<tr><td class="empty" colspan="${head.length + boxes.length + 2}">${escape(words.empty)}</td></tr>`
      : rows
          .map(
            (row) =>
              `<tr><td class="num">${row.no}</td><td>${escape(day(row.item.date))}</td><td>${escape(number(row, language))}</td><td>${escape(party(row, language))}</td><td>${escape(row.item.nui ?? '')}</td>${amounts(row)
                .map((value) => `<td class="num">${eur(value)}</td>`)
                .join('')}</tr>`,
          )
          .join('');
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(`${title} ${monthTitle(month, language)}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600&family=Source+Serif+4:opsz,wght@8..60,500&display=swap" rel="stylesheet">
<style>
  :root { --ink: #141413; --ink-muted: #5e5d59; --hairline: #e0dbcf; --hairline-strong: #cbc3b3; --sunk: #f0eee6; --clay-text: #a8482a; }
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 400 7.5pt/1.35 'Hanken Grotesk', system-ui, sans-serif; font-variant-numeric: tabular-nums; padding: 8mm; }
  @media print { body { padding: 0; } }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px double var(--ink); padding-bottom: 3mm; margin-bottom: 4mm; }
  h1 { font: 500 16pt/1.2 'Source Serif 4', Georgia, serif; margin: 0; }
  header p { margin: 0; color: var(--ink-muted); }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: left; font-weight: 600; vertical-align: bottom; border-bottom: 1px solid var(--hairline-strong); padding: 1.5mm 1mm; }
  th .box { display: block; color: var(--clay-text); }
  td { border-bottom: 1px solid var(--hairline); padding: 1.2mm 1mm; vertical-align: top; }
  tbody tr:nth-child(even) td { background: var(--sunk); }
  .num { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: 600; border-top: 1px solid var(--ink); border-bottom: 0; }
  .empty { text-align: center; color: var(--ink-muted); padding: 8mm; }
</style>
</head>
<body>
<header>
  <div><h1>${escape(title)}</h1><p>${escape(monthTitle(month, language))}</p></div>
  <p>${escape(business.name)}${business.nui ? ` · ${escape(words.nui)} ${escape(business.nui)}` : ''}</p>
</header>
<table>
<thead><tr>${head.map((label, index) => `<th${index >= 5 ? ' class="num"' : ''}>${escape(label)}</th>`).join('')}${boxes
    .map((box) => `<th class="num"><span class="box">[${box}]</span>${escape(BOX_LABELS[language][box]!)}</th>`)
    .join('')}<th class="num">${escape(words.vat18)}</th><th class="num">${escape(words.vat8)}</th></tr></thead>
<tbody>${body}</tbody>
${rows.length === 0 ? '' : `<tfoot><tr><td colspan="5">${escape(words.total)}</td>${totals.map((value) => `<td class="num">${eur(value)}</td>`).join('')}</tr></tfoot>`}
</table>
</body>
</html>`;
}

export function withholdingSheet(rows: WithholdingRow[], month: string, language: Language): { basename: string; sheet: Sheet<WithholdingRow> } {
  const words = WORDS[language];
  return {
    basename: `${words.withholding} ${month}`,
    sheet: {
      name: words.withholding,
      subtitle: monthTitle(month, language),
      columns: [
        { header: words.date, value: (row) => row.date, kind: 'date' },
        { header: words.supplier, value: (row) => row.supplier ?? '' },
        { header: words.nui, value: (row) => row.nui ?? '' },
        { header: words.number, value: (row) => row.number ?? '' },
        { header: words.type, value: (row) => words.withholdingTypes[row.type] ?? row.type },
        { header: words.rate, value: (row) => `${row.rate ?? WITHHOLDING_RATES[row.type]}%` },
        { header: words.gross, value: (row) => row.gross, kind: 'money', total: true },
        { header: words.withheld, value: (row) => row.withheld, kind: 'money', total: true },
      ],
      rows,
      totals: { inCsv: false },
    },
  };
}

export function yearSheet(rows: VatYearRow[], year: number, language: Language): { basename: string; sheet: Sheet<VatYearRow> } {
  const words = WORDS[language];
  return {
    basename: `${words.year} ${year}`,
    sheet: {
      name: words.year,
      subtitle: String(year),
      columns: [
        { header: words.month, value: (row) => MONTHS[language][Number(row.month.slice(5, 7)) - 1]! },
        { header: words.status, value: (row) => words[row.status] },
        { header: words.sales, value: (row) => row.sales, kind: 'money', total: true },
        { header: words.purchases, value: (row) => row.purchases, kind: 'money', total: true },
        { header: words.equipment, value: (row) => row.equipment, kind: 'money', total: true },
        { header: words.charged, value: (row) => row.charged, kind: 'money', total: true },
        { header: words.claimable, value: (row) => row.claimable, kind: 'money', total: true },
        { header: words.difference, value: (row) => row.difference, kind: 'money', total: true },
        { header: words.carriedIn, value: (row) => row.carriedIn, kind: 'money' },
        { header: words.carriedOut, value: (row) => row.carriedOut, kind: 'money' },
        { header: words.toPay, value: (row) => row.toPay, kind: 'money', total: true },
      ],
      rows,
      totals: { inCsv: false },
    },
  };
}
