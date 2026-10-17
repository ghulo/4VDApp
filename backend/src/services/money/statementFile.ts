import ExcelJS from 'exceljs';
import { roundMoney } from '../../utils/money.js';

/**
 * Reading a bank's statement export (Excel or CSV). Kosovo banks write dates
 * as 13.10.2026 and money as 1.234,56, with Albanian headers (Data,
 * Përshkrimi, Debi, Kredi, Bilanci); some write one signed amount column
 * instead of Debi and Kredi. The columns are found by their headers; when that
 * isn't certain, the person says which column is which once, and the layout
 * is remembered for that bank account.
 *
 * Checked so far against made-up files only; a real statement from the shop's
 * bank still has to be tried (handoff.md).
 */

export type Cell = string | number | Date | null;

/** Which column holds what, by position (0 = first), under the header on row `headerRow`. */
export interface StatementLayout {
  headerRow: number;
  date: number;
  text: number;
  /** A second text column (the other party's name), joined to the text. */
  party: number | null;
  moneyIn: number | null;
  moneyOut: number | null;
  /** One signed column instead of money in and out. */
  amount: number | null;
  balance: number | null;
  /** The header row's cells, to know the same layout again. */
  headers: string[];
}

export interface StatementLine {
  day: string;
  text: string;
  /** Money in above zero, money out below. */
  amount: number;
  balance: number | null;
}

export interface ReadStatement {
  lines: StatementLine[];
  openingBalance: number | null;
  closingBalance: number | null;
  /** Rows under the header that held a date but no readable amount, or the other way round. */
  unreadable: number;
}

/** Lower case, no accents (ë → e, ç → c), single spaces: how headers and texts are compared. */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const HEADERS: Record<'date' | 'valueDate' | 'text' | 'party' | 'moneyIn' | 'moneyOut' | 'amount' | 'balance', string[]> = {
  date: ['data', 'date', 'data e transaksionit', 'data transaksionit', 'data e kontabilizimit', 'data e regjistrimit', 'data e postimit', 'booking date', 'transaction date', 'posting date', 'datum'],
  valueDate: ['data e valutes', 'data valutes', 'valuta', 'value date', 'datum valute'],
  text: [
    'pershkrimi',
    'pershkrim',
    'pershkrimi i transaksionit',
    'pershkrimi i pageses',
    'description',
    'transaction description',
    'details',
    'transaction details',
    'detajet',
    'narrative',
    'qellimi',
    'qellimi i pageses',
    'informata',
    'opis',
  ],
  party: ['perfituesi', 'paguesi', 'beneficiary', 'payer', 'partner', 'pala', 'emri', 'counterparty', 'derguesi', 'marresi', 'emri i perfituesit', 'emri i paguesit'],
  moneyOut: ['debi', 'debit', 'dalje', 'terheqje', 'withdrawal', 'withdrawals', 'paid out', 'money out', 'shuma debi', 'debitimi', 'duguje', 'out'],
  moneyIn: ['kredi', 'credit', 'hyrje', 'depozite', 'deposit', 'deposits', 'paid in', 'money in', 'shuma kredi', 'kreditimi', 'potrazuje', 'in'],
  amount: ['shuma', 'amount', 'vlera', 'iznos', 'shuma e transaksionit', 'transaction amount'],
  balance: ['bilanci', 'saldo', 'balance', 'gjendja', 'running balance', 'bilanci pas transaksionit', 'saldo pas transaksionit', 'stanje', 'available balance'],
};

function headerKind(cell: Cell): keyof typeof HEADERS | null {
  if (typeof cell !== 'string') return null;
  const text = normalise(cell);
  if (!text) return null;
  for (const [kind, names] of Object.entries(HEADERS) as Array<[keyof typeof HEADERS, string[]]>) {
    if (names.includes(text)) return kind;
  }
  // "Shuma Debi (EUR)", "Data e transaksionit / Transaction date": the first known name it starts with.
  for (const [kind, names] of Object.entries(HEADERS) as Array<[keyof typeof HEADERS, string[]]>) {
    if (names.some((name) => name.length >= 4 && (text.startsWith(`${name} `) || text.endsWith(` ${name}`)))) return kind;
  }
  return null;
}

/** "1.234,56", "1,234.56", "-45,00", "(45.00)", "45,00 EUR" → a number; null when it isn't money. */
export function parseMoney(cell: Cell): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? roundMoney(cell) : null;
  if (typeof cell !== 'string') return null;
  let text = cell.replace(/\s| /g, '').replace(/eur|€/gi, '');
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith('-')) {
    negative = true;
    text = text.slice(0, -1);
  }
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) text = text.slice(1);
  if (!/^[\d.,']+$/.test(text) || !/\d/.test(text)) return null;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  let decimal: ',' | '.' | null = null;
  if (lastComma >= 0 && lastDot >= 0) decimal = lastComma > lastDot ? ',' : '.';
  else if (lastComma >= 0) decimal = text.length - lastComma - 1 === 3 && text.split(',').length > 2 ? null : text.length - lastComma - 1 <= 2 ? ',' : null;
  else if (lastDot >= 0) decimal = text.length - lastDot - 1 === 3 && /^\d{1,3}(\.\d{3})+$/.test(text) ? null : '.';
  const thousands = decimal === ',' ? /[.']/g : /[,']/g;
  let plain = text.replace(thousands, '');
  if (decimal === ',') plain = plain.replace(',', '.');
  if (decimal === null) plain = plain.replace(/[.,]/g, '');
  const value = Number(plain);
  if (!Number.isFinite(value)) return null;
  return roundMoney(negative ? -value : value);
}

const pad = (value: number) => String(value).padStart(2, '0');

/** "13.10.2026", "13/10/2026", "2026-10-13", "13.10.26", an Excel date or day number → "2026-10-13"; null when it isn't a day. */
export function parseDay(cell: Cell): string | null {
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return null;
    return `${cell.getUTCFullYear()}-${pad(cell.getUTCMonth() + 1)}-${pad(cell.getUTCDate())}`;
  }
  if (typeof cell === 'number') {
    // Excel's day numbers: 45000 is in 2023.
    if (cell < 20_000 || cell > 80_000) return null;
    return parseDay(new Date(Date.UTC(1899, 11, 30) + Math.floor(cell) * 86_400_000));
  }
  if (typeof cell !== 'string') return null;
  const text = cell.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (match) return checked(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\D|$)/.exec(text);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    return checked(year, Number(match[2]), Number(match[1]));
  }
  return null;
}

function checked(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Split one CSV line, with quotes. */
function splitCsvLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** A CSV file as rows of cells: UTF-8 (or Windows-1250 when it isn't), separated by ; , or tab, whichever splits the lines most evenly. */
export function readCsv(bytes: Buffer): Cell[][] {
  let text = bytes.toString('utf8');
  if (text.includes('�')) text = new TextDecoder('windows-1250').decode(bytes);
  text = text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const separators = [';', ',', '\t', '|'];
  const best = separators
    .map((separator) => {
      const widths = lines.slice(0, 30).map((line) => splitCsvLine(line, separator).length);
      const common = widths.sort((a, b) => widths.filter((width) => width === b).length - widths.filter((width) => width === a).length)[0] ?? 1;
      return { separator, common };
    })
    .sort((a, b) => b.common - a.common)[0]!;
  return lines.map((line) => splitCsvLine(line, best.separator).map((cell) => (cell === '' ? null : cell)));
}

/** The first sheet of an Excel file as rows of cells. */
export async function readXlsx(bytes: Buffer): Promise<Cell[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new Error('not-xlsx');
  }
  const sheet = workbook.worksheets.find((candidate) => candidate.actualRowCount > 0);
  if (!sheet) return [];
  const rows: Cell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: Cell[] = [];
    for (let column = 1; column <= row.cellCount; column += 1) {
      const value = row.getCell(column).value;
      cells.push(cellValue(value));
    }
    rows.push(cells);
  });
  return rows;
}

function cellValue(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string' || value instanceof Date) return value;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined) return cellValue(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
  }
  return String(value);
}

/** The row that names the columns and which column is which; `sure` when the headers leave no doubt. */
export function detectLayout(rows: Cell[][]): { layout: StatementLayout; sure: boolean } | null {
  let best: { layout: StatementLayout; score: number } | null = null;
  for (let headerRow = 0; headerRow < Math.min(rows.length, 40); headerRow += 1) {
    const row = rows[headerRow]!;
    const found: Partial<Record<keyof typeof HEADERS, number>> = {};
    row.forEach((cell, column) => {
      const kind = headerKind(cell);
      if (kind && found[kind] === undefined) found[kind] = column;
    });
    const date = found.date ?? found.valueDate;
    if (date === undefined) continue;
    const hasMoney = (found.moneyIn !== undefined && found.moneyOut !== undefined) || found.amount !== undefined;
    const score = Object.keys(found).length + (hasMoney ? 3 : 0) + (found.text !== undefined ? 2 : 0);
    if (!best || score > best.score) {
      best = {
        score,
        layout: {
          headerRow,
          date,
          text: found.text ?? found.party ?? -1,
          party: found.text !== undefined ? (found.party ?? null) : null,
          moneyIn: found.amount === undefined || found.moneyIn !== undefined ? (found.moneyIn ?? null) : null,
          moneyOut: found.amount === undefined || found.moneyOut !== undefined ? (found.moneyOut ?? null) : null,
          amount: found.moneyIn !== undefined && found.moneyOut !== undefined ? null : (found.amount ?? null),
          balance: found.balance ?? null,
          headers: row.map((cell) => (cell === null ? '' : String(cell))),
        },
      };
    }
  }
  if (!best) return null;
  const { layout } = best;
  const complete = layout.text >= 0 && ((layout.moneyIn !== null && layout.moneyOut !== null) || layout.amount !== null);
  if (!complete) return { layout, sure: false };
  // The headers look right; the rows under them must read too.
  const read = applyLayout(rows, layout);
  const sure = read.lines.length > 0 && read.unreadable <= Math.max(1, read.lines.length * 0.1);
  return { layout, sure };
}

/** Whether a saved layout fits this file: its header row is there, cell for cell. */
export function layoutFits(rows: Cell[][], layout: StatementLayout): StatementLayout | null {
  const wanted = layout.headers.map((header) => normalise(header));
  for (let headerRow = 0; headerRow < Math.min(rows.length, 40); headerRow += 1) {
    const cells = rows[headerRow]!.map((cell) => normalise(cell === null ? '' : String(cell)));
    if (wanted.every((header, index) => header === (cells[index] ?? ''))) return { ...layout, headerRow };
  }
  return null;
}

/** The lines under the header, oldest first, with the balances before and after. */
export function applyLayout(rows: Cell[][], layout: StatementLayout): ReadStatement {
  const lines: StatementLine[] = [];
  let unreadable = 0;
  for (const row of rows.slice(layout.headerRow + 1)) {
    const day = parseDay(row[layout.date] ?? null);
    let amount: number | null = null;
    if (layout.amount !== null) amount = parseMoney(row[layout.amount] ?? null);
    else {
      const moneyIn = layout.moneyIn === null ? null : parseMoney(row[layout.moneyIn] ?? null);
      const moneyOut = layout.moneyOut === null ? null : parseMoney(row[layout.moneyOut] ?? null);
      if (moneyIn !== null || moneyOut !== null) amount = roundMoney(Math.abs(moneyIn ?? 0) - Math.abs(moneyOut ?? 0));
    }
    const textCell = layout.text >= 0 ? row[layout.text] : null;
    const partyCell = layout.party === null ? null : row[layout.party];
    const text = [textCell, partyCell]
      .filter((cell): cell is string | number => cell !== null && cell !== undefined && String(cell).trim() !== '')
      .map((cell) => String(cell).replace(/\s+/g, ' ').trim())
      .join(' · ');
    if (day === null && amount === null) continue;
    if (day === null || amount === null) {
      // Totals rows ("Gjithsej") and opening-balance rows have one without the other.
      if (!/gjithsej|total|bilanci fillestar|saldo fillestare|opening|closing|bilanci perfundimtar/.test(normalise(text))) unreadable += 1;
      continue;
    }
    if (amount === 0) continue;
    lines.push({ day, text: text.slice(0, 500) || '—', amount, balance: layout.balance === null ? null : parseMoney(row[layout.balance] ?? null) });
  }
  return { ...withBalances(lines), unreadable };
}

/** Oldest first (a bank that lists newest first is turned round), and the balances the statement starts and ends with. */
export function withBalances(lines: StatementLine[]): { lines: StatementLine[]; openingBalance: number | null; closingBalance: number | null } {
  const ordered = lines.length > 1 && lines[0]!.day > lines[lines.length - 1]!.day ? [...lines].reverse() : lines;
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  return {
    lines: ordered,
    openingBalance: first && first.balance !== null ? roundMoney(first.balance - first.amount) : null,
    closingBalance: last?.balance ?? null,
  };
}

/** The same line in a later, overlapping statement gets the same fingerprint, so it is skipped. */
export function fingerprints(lines: StatementLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const key = `${line.day}|${line.amount.toFixed(2)}|${normalise(line.text).slice(0, 300)}|${line.balance === null ? '' : line.balance.toFixed(2)}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return `${key}|${count}`;
  });
}

/** The first rows of a file, as text, for the person to say which column is which. */
export function preview(rows: Cell[][], count = 15): string[][] {
  return rows.slice(0, count).map((row) => row.map((cell) => (cell === null ? '' : cell instanceof Date ? (parseDay(cell) ?? '') : String(cell))));
}
