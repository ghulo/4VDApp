import ExcelJS from 'exceljs';
import { type CsvColumn, toCsv } from './csv.js';

/** How a column's values are written and formatted in Excel. */
export type ColumnKind = 'text' | 'money' | 'number' | 'date' | 'datetime';

export interface ExportColumn<TRow> extends CsvColumn<TRow> {
  kind?: ColumnKind;
  /** Summed in the totals row. */
  total?: boolean;
}

export interface Sheet<TRow> {
  /** The tab name in Excel and the start of the file name, e.g. "Sales". */
  name: string;
  /** The line under the title, e.g. "1 Oct 2026 to 31 Oct 2026". */
  subtitle: string;
  columns: ExportColumn<TRow>[];
  rows: TRow[];
  /** Adds a "Total" row summing the `total` columns. CSV gets it only with `inCsv`, so imports stay clean. */
  totals?: { inCsv: boolean };
}

type Cell = string | number | null;

function matrix<TRow>(sheet: Sheet<TRow>): Cell[][] {
  return sheet.rows.map((row) => sheet.columns.map((column) => column.value(row)));
}

function totalsRow<TRow>(sheet: Sheet<TRow>, cells: Cell[][]): Cell[] {
  return sheet.columns.map((column, index) => {
    if (index === 0) return 'Total';
    if (!column.total) return null;
    // Cents, so floating-point sums don't print as 12.000000001.
    return Math.round(cells.reduce((sum, row) => sum + (typeof row[index] === 'number' ? (row[index] as number) : 0), 0) * 100) / 100;
  });
}

export function sheetToCsv<TRow>(sheet: Sheet<TRow>): string {
  const cells = matrix(sheet);
  if (sheet.totals?.inCsv) cells.push(totalsRow(sheet, cells));
  return toCsv(
    sheet.columns.map((column, index) => ({ header: column.header, value: (row: Cell[]) => row[index] ?? null })),
    cells,
  );
}

// The 4VD palette (DESIGN.md light theme), as Excel ARGB.
const INK = 'FF141413';
const MUTED = 'FF5E5D59';
const PAPER = 'FFFAF9F5';
const BAND = 'FFF0EEE6';
const LINE = 'FFE0DBCF';
const LINE_STRONG = 'FFCBC3B3';
const CLAY = 'FFA8482A';

const FORMATS: Record<ColumnKind, string | undefined> = {
  text: undefined,
  money: '"€"#,##0.00;[Red]-"€"#,##0.00',
  number: '#,##0.##',
  date: 'd mmm yyyy',
  datetime: 'd mmm yyyy hh:mm',
};

/** "2026-03-10" or "2026-03-10 14:05" as that wall-clock time; Excel dates have no time zone. */
function toExcelDate(value: string): Date | string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour = '0', minute = '0'] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
}

/** Text that Excel would run as a formula keeps a leading apostrophe, as in the CSV. */
const safeText = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

/**
 * A finished-looking workbook: a dark title band with the 4VD name, what the
 * sheet is and for when, then a frozen header row with filters, euro and date
 * formats, banded rows and a totals row worked out by formulas.
 */
export async function sheetToXlsx<TRow>(sheet: Sheet<TRow>, madeAt: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '4VD';
  workbook.created = new Date();
  const header = 4;
  const ws = workbook.addWorksheet(sheet.name, {
    views: [{ state: 'frozen', ySplit: header, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
    headerFooter: { oddFooter: `&L4VD · ${sheet.name}&RPage &P of &N` },
  });
  const width = sheet.columns.length;
  const cells = matrix(sheet);

  // Title band: two dark rows across the sheet, a clay rule under them.
  ws.mergeCells(1, 1, 1, width);
  ws.mergeCells(2, 1, 2, width);
  const title = ws.getCell(1, 1);
  title.value = `4VD  ·  ${sheet.name}`;
  title.font = { name: 'Calibri', size: 18, bold: true, color: { argb: PAPER } };
  const subtitle = ws.getCell(2, 1);
  subtitle.value = `${sheet.subtitle}   ·   made ${madeAt}`;
  subtitle.font = { name: 'Calibri', size: 10, color: { argb: LINE_STRONG } };
  for (const row of [1, 2]) {
    ws.getRow(row).height = row === 1 ? 32 : 20;
    for (let column = 1; column <= width; column += 1) {
      const cell = ws.getCell(row, column);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
      cell.alignment = { vertical: 'middle', indent: 1 };
      if (row === 2) cell.border = { bottom: { style: 'thick', color: { argb: CLAY } } };
    }
  }
  ws.getRow(3).height = 8;

  // Header row.
  const headRow = ws.getRow(header);
  headRow.height = 22;
  sheet.columns.forEach((column, index) => {
    const cell = headRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, size: 10, color: { argb: INK } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    cell.alignment = { vertical: 'middle', horizontal: column.kind && column.kind !== 'text' ? 'right' : 'left', indent: 1 };
    cell.border = { bottom: { style: 'medium', color: { argb: LINE_STRONG } } };
  });

  // Data rows, banded.
  cells.forEach((values, rowIndex) => {
    const row = ws.getRow(header + 1 + rowIndex);
    row.height = 18;
    sheet.columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      const value = values[index] ?? null;
      const kind = column.kind ?? 'text';
      cell.value = value === null ? null : typeof value === 'string' ? (kind === 'date' || kind === 'datetime' ? toExcelDate(value) : safeText(value)) : value;
      if (FORMATS[kind]) cell.numFmt = FORMATS[kind]!;
      cell.font = { size: 10, color: { argb: INK } };
      cell.alignment = { vertical: 'middle', horizontal: kind === 'text' ? 'left' : 'right', indent: 1, wrapText: false };
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      if (rowIndex % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } };
    });
  });

  const firstData = header + 1;
  const lastData = header + cells.length;
  if (cells.length > 0) ws.autoFilter = { from: { row: header, column: 1 }, to: { row: header, column: width } };

  // Totals: live SUM formulas, with the result filled in for viewers that don't calculate.
  if (sheet.totals && cells.length > 0) {
    const sums = totalsRow(sheet, cells);
    const row = ws.getRow(lastData + 1);
    row.height = 22;
    sheet.columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      if (index === 0) cell.value = 'Total';
      else if (column.total) {
        const letter = ws.getColumn(index + 1).letter;
        cell.value = { formula: `SUM(${letter}${firstData}:${letter}${lastData})`, result: sums[index] as number };
        cell.numFmt = FORMATS[column.kind ?? 'number'] ?? FORMATS.number!;
      }
      cell.font = { bold: true, size: 10, color: { argb: INK } };
      cell.alignment = { vertical: 'middle', horizontal: index === 0 || !column.total ? 'left' : 'right', indent: 1 };
      cell.border = { top: { style: 'medium', color: { argb: INK } } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    });
  }

  // Widths from the longest value, within reason.
  sheet.columns.forEach((column, index) => {
    const kind = column.kind ?? 'text';
    const longest = Math.max(
      column.header.length,
      ...cells.map((values) => {
        const value = values[index];
        if (value === null || value === undefined) return 0;
        if (kind === 'money') return String(Math.round(Number(value))).length + 6;
        if (kind === 'datetime') return 17;
        if (kind === 'date') return 12;
        return String(value).length;
      }),
    );
    ws.getColumn(index + 1).width = Math.min(Math.max(longest + 4, 10), 48);
  });
  if (cells.length === 0) {
    const empty = ws.getCell(header + 1, 1);
    empty.value = 'Nothing in this period.';
    empty.font = { italic: true, size: 10, color: { argb: MUTED } };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
