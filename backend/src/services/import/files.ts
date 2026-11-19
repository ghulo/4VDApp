import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { TooBigToUnpackError, UnpackBudget, rethrowIfTooBig } from '../../utils/unpackLimits.js';
import { PROFILES, baseName } from './fields.js';

/**
 * Reading whatever a business drops on Settings → Import: Excel, CSV, a .zip
 * or the files of a whole folder. Everything 4VD can tell about a file on its
 * own is said in plain words (a password, an old Excel format, letters saved
 * in an old Windows format, an empty sheet) instead of a bare "can't read".
 */

export type Cell = string | number | null;

export interface ReadSheet {
  /** The file it came from, with its folder inside a .zip ("export/products.csv"). */
  file: string;
  /** The sheet's name in an Excel file; null for a CSV. */
  sheet: string | null;
  rows: Cell[][];
}

/** Something worth telling about a file, keyed for the dashboard to word in either language. */
export interface FileNote {
  file: string;
  key:
    | 'password'
    | 'oldExcel'
    | 'notReadable'
    | 'notSpreadsheet'
    | 'emptySheet'
    | 'oldLetters'
    | 'zipTooBig'
    | 'skippedInZip';
  sheet?: string | null;
}

export interface ReadFiles {
  sheets: ReadSheet[];
  notes: FileNote[];
  /** Files inside a zip that 4VD knows are history and didn't unpack. */
  leftOut: string[];
}

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** "EncryptedPackage" in UTF-16: the stream a password-protected .xlsx keeps its real content in. */
const ENCRYPTED = Buffer.from('EncryptedPackage', 'utf16le');

const startsWith = (bytes: Buffer, magic: Buffer) => bytes.length >= magic.length && bytes.subarray(0, magic.length).equals(magic);

/**
 * One budget covers the whole drop (utils/unpackLimits.ts). A file (or a file
 * inside a zip) that would unpack past it is left out with the note
 * "zipTooBig": what it read is dropped and its rows given back, so the files
 * after it still fit; the unpacked bytes stay spent.
 */
export async function readFiles(files: Array<{ name: string; bytes: Buffer }>, budget = new UnpackBudget()): Promise<ReadFiles> {
  const out: ReadFiles = { sheets: [], notes: [], leftOut: [] };
  for (const file of files) await guarded(file.name, out, budget, () => readOne(file.name, file.bytes, out, 0, budget));
  return out;
}

async function guarded(name: string, out: ReadFiles, budget: UnpackBudget, read: () => Promise<void>): Promise<void> {
  const mark = budget.mark();
  const sheets = out.sheets.length;
  try {
    await read();
  } catch (error) {
    if (!(error instanceof TooBigToUnpackError)) throw error;
    out.sheets.length = sheets;
    budget.restore(mark);
    out.notes.push({ file: name, key: 'zipTooBig' });
  }
}

async function readOne(name: string, bytes: Buffer, out: ReadFiles, depth: number, budget: UnpackBudget): Promise<void> {
  const lower = name.toLowerCase();
  if (bytes.length === 0) {
    out.notes.push({ file: name, key: 'emptySheet', sheet: null });
    return;
  }
  if (startsWith(bytes, OLE)) {
    // An old binary Office file: either a password-protected .xlsx (Excel wraps it this way) or Excel 97-2003.
    out.notes.push({ file: name, key: bytes.includes(ENCRYPTED) ? 'password' : 'oldExcel' });
    return;
  }
  if (startsWith(bytes, ZIP)) {
    let zip: JSZip;
    try {
      zip = await budget.openZip(bytes);
    } catch (error) {
      rethrowIfTooBig(error);
      out.notes.push({ file: name, key: 'notReadable' });
      return;
    }
    if (zip.file('[Content_Types].xml') && zip.folder('xl')) {
      await readWorkbook(name, bytes, out, budget);
      return;
    }
    if (lower.endsWith('.ods') || zip.file('mimetype')) {
      out.notes.push({ file: name, key: 'notSpreadsheet' });
      return;
    }
    if (depth > 0) return;
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || entry.name.startsWith('__MACOSX/') || /(^|\/)\./.test(entry.name)) continue;
      if (!/\.(csv|txt|xlsx|xls)$/i.test(entry.name)) {
        out.notes.push({ file: `${name}/${entry.name}`, key: 'skippedInZip' });
        continue;
      }
      // History 4VD leaves out (TREFIN's sales.csv) is not even unpacked: only its name is kept.
      const base = baseName(entry.name);
      if (PROFILES.some((profile) => profile.leftOut.some((item) => item.name.test(base)))) {
        out.leftOut.push(entry.name);
        continue;
      }
      // Unpacked chunk by chunk and counted as it comes: a tiny zip can unpack to gigabytes, and its headers can lie.
      await guarded(`${name}/${entry.name}`, out, budget, async () => {
        let inner: Buffer;
        try {
          inner = await budget.read(entry, true);
        } catch (error) {
          rethrowIfTooBig(error);
          out.notes.push({ file: `${name}/${entry.name}`, key: 'notReadable' });
          return;
        }
        await readOne(entry.name, inner, out, depth + 1, budget);
      });
    }
    return;
  }
  if (/\.(csv|txt|tsv)$/.test(lower) || looksLikeText(bytes)) {
    const { text, oldLetters } = decodeText(bytes);
    if (oldLetters) out.notes.push({ file: name, key: 'oldLetters' });
    const rows = parseDelimited(text, budget);
    if (rows.length === 0) out.notes.push({ file: name, key: 'emptySheet', sheet: null });
    else out.sheets.push({ file: name, sheet: null, rows });
    return;
  }
  out.notes.push({ file: name, key: 'notSpreadsheet' });
}

async function readWorkbook(name: string, bytes: Buffer, out: ReadFiles, budget: UnpackBudget): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS unpacks every part at once: walk and count them first.
    await budget.checkWorkbook(bytes);
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch (error) {
    rethrowIfTooBig(error);
    out.notes.push({ file: name, key: 'notReadable' });
    return;
  }
  for (const sheet of workbook.worksheets) {
    if (sheet.state && sheet.state !== 'visible') continue;
    const rows: Cell[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      budget.addRows(1);
      budget.addCells(row.cellCount);
      const cells: Cell[] = [];
      for (let column = 1; column <= row.cellCount; column += 1) cells.push(cellValue(row.getCell(column).value));
      if (cells.some((cell) => cell !== null && cell !== '')) rows.push(cells);
    });
    if (rows.length === 0) out.notes.push({ file: name, key: 'emptySheet', sheet: sheet.name });
    else out.sheets.push({ file: name, sheet: sheet.name, rows });
  }
}

function cellValue(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    if ('error' in value) return null;
    if ('result' in value) return value.result === undefined ? null : cellValue(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
  }
  return String(value);
}

/** No zero bytes in the first few KB: a text file, whatever its name says. */
function looksLikeText(bytes: Buffer): boolean {
  return !bytes.subarray(0, 4096).includes(0);
}

/**
 * UTF-8 when the bytes are valid UTF-8; otherwise the Windows code page older
 * Kosovo programs save in (1250 covers ë and ç), and the dashboard says the
 * letters were fixed.
 */
export function decodeText(bytes: Buffer): { text: string; oldLetters: boolean } {
  let text: string;
  let oldLetters = false;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1250').decode(bytes);
    oldLetters = /[^\x00-\x7f]/.test(text);
  }
  return { text: text.replace(/^﻿/, ''), oldLetters };
}

/**
 * A CSV (or ; or tab separated) file as rows of cells, quotes and line breaks
 * inside quotes included. The separator is the one that splits the first line
 * into the most columns.
 */
export function parseDelimited(text: string, budget?: UnpackBudget): Cell[][] {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const separator = [';', ',', '\t', '|'].map((sep) => ({ sep, n: splitCount(firstLine, sep) })).sort((a, b) => b.n - a.n)[0]!.sep;
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  const endField = () => {
    budget?.addCells(1);
    const value = field.trim();
    row.push(value === '' ? null : value);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell !== null)) {
      budget?.addRows(1);
      rows.push(row);
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (ch === separator) endField();
    else if (ch === '\n') endRow();
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function splitCount(line: string, separator: string): number {
  let n = 1;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === separator && !quoted) n++;
  }
  return n;
}
