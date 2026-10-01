export interface CsvColumn<TRow> {
  header: string;
  value: (row: TRow) => string | number | null;
}

// Spreadsheet apps run cells starting with these as formulas (CSV injection).
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

function formatCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);

  const safe = FORMULA_TRIGGERS.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * CSV that opens cleanly in Excel: the byte-order mark makes it read UTF-8
 * (so € and accents survive), and lines end in CRLF.
 */
export function toCsv<TRow>(columns: CsvColumn<TRow>[], rows: TRow[]): string {
  const lines = [
    columns.map((column) => formatCell(column.header)).join(','),
    ...rows.map((row) => columns.map((column) => formatCell(column.value(row))).join(',')),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}
