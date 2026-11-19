import { unitFromTrefin } from '../../constants/units.js';
import type { ProductUnit } from '../../database/types.js';
import { roundMoney } from '../../utils/money.js';
import { normalise, parseMoney } from '../money/statementFile.js';
import type { Cell, FileNote, ReadSheet } from './files.js';
import { type Field, HEADINGS, type ImportKind, IMPORT_KINDS, KIND_BY_FILE_NAME, PROFILES, type Profile, baseName, fieldForHeading } from './fields.js';

/**
 * Working out what an import will do, without touching the database: which
 * program the files came from, what each sheet and column holds, which rows
 * are new, changed or the same as what 4VD has, and what needs a decision.
 * Pure, so the preview can be worked out again in a blink each time the
 * person changes an answer.
 */

/** The leftover category every product without one goes to. */
export const OTHER_CATEGORY = 'Të ndryshme';
/** Pairs at least this alike (0..1) are offered as possible duplicates. */
const SIMILAR = 0.88;
const VAT_RATES = [0, 8, 16, 18];
/** How many rows of each problem the preview shows; the download has them all. */
const SAMPLE = 5;

// ---------- What the database already has (read by the service) ----------

export interface ExistingProduct {
  id: number;
  name: string;
  sku: string | null;
  barcodes: string[];
  price: number;
  cost: number | null;
  wholesale: number | null;
  vat: number;
  category: string;
}
export interface ExistingPartner {
  id: number;
  name: string;
  code: string | null;
  nui: string | null;
}
export interface Existing {
  products: ExistingProduct[];
  suppliers: ExistingPartner[];
  customers: ExistingPartner[];
  categories: string[];
  /** The books: when they start and whether the opening is posted (decides stock and what is owed). */
  books: { startDay: string | null; openingPosted: boolean };
}

// ---------- What the person decided ----------

export interface SheetOverride {
  kind?: ImportKind | 'skip';
  /** Field → column index (0 = first), or -1 to leave a guessed field out. */
  mapping?: Partial<Record<Field, number>>;
}
export interface RowFix {
  price?: number;
  cost?: number | null;
}
export interface Choices {
  problems?: Record<string, string>;
  sheets?: Record<string, SheetOverride>;
  fixes?: Record<string, RowFix>;
  /** 'bring' (usual) or 'none': bring products in without their stock. */
  stock?: 'bring' | 'none';
}

// ---------- What was read, kept in the draft ----------

export interface Recognised {
  profile: { id: string; name: string } | null;
  sheets: SheetPlan[];
  /** Files known and left out on purpose (history, files only used for checks). */
  leftOut: Array<{ file: string; why: 'history' | 'notNeeded' | 'unknown' }>;
  /** product code → category, from the profile's categories file. */
  categoryFile: Record<string, string>;
}

export interface SheetPlan {
  /** Stable key: the file and sheet. */
  key: string;
  index: number;
  file: string;
  sheet: string | null;
  kind: ImportKind | 'skip';
  /** How sure 4VD is of the kind: a profile, a saved layout, or the headings. */
  kindSure: boolean;
  headerRow: number;
  headers: string[];
  mapping: Partial<Record<Field, number>>;
  /** Fields 4VD guessed from a heading that only partly matched: the person confirms them. */
  guessed: Field[];
  /** Saved from an earlier import of a file like this. */
  remembered: boolean;
  /** Profile files can say products of some types come in inactive. */
  activeColumn?: { index: number; equals: string };
  soldByScaleColumn?: number;
  signature: string;
}

// ---------- The records ----------

export interface ProductRecord {
  rowKey: string;
  row: number;
  sheet: string;
  code: string | null;
  barcode: string | null;
  barcodeCut: boolean;
  otherBarcodes: string[];
  name: string | null;
  category: string | null;
  unit: ProductUnit;
  price: number | null;
  wholesale: number | null;
  cost: number | null;
  vat: number | null;
  stock: number | null;
  reorder: number | null;
  supplier: string | null;
  active: boolean;
}
export interface PartnerRecord {
  rowKey: string;
  row: number;
  sheet: string;
  code: string | null;
  name: string | null;
  nui: string | null;
  businessNo: string | null;
  fiscalNo: string | null;
  vatNo: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  iban: string | null;
  contact: string | null;
  owed: number | null;
  creditLimit: number | null;
  discount: number | null;
}

export type ProductChangeField = 'name' | 'price' | 'cost' | 'wholesale' | 'vat' | 'category';
export interface PlannedProduct {
  record: ProductRecord;
  action: 'new' | 'changed' | 'same';
  existingId: number | null;
  changes: Array<{ field: ProductChangeField; from: string | number | null; to: string | number | null }>;
  /** Filled in after the choices: what will be written. */
  final: { price: number; cost: number | null; vat: number; category: string; stock: number; active: boolean; barcode: string | null };
}
export interface PlannedPartner {
  record: PartnerRecord;
  kind: 'suppliers' | 'customers';
  action: 'new' | 'same';
  existingId: number | null;
}

export type ProblemKey =
  | 'dupBarcode'
  | 'barcodeCut'
  | 'costAbovePrice'
  | 'noPrice'
  | 'noCost'
  | 'oddVat'
  | 'similar'
  | 'noCategory'
  | 'dupPartner';
export const PROBLEM_CHOICES: Record<ProblemKey, string[]> = {
  dupBarcode: ['keepFirst', 'skipAll'],
  barcodeCut: ['noBarcode', 'skip'],
  costAbovePrice: ['emptyCost', 'asIs', 'skip'],
  noPrice: ['inactive', 'skip'],
  noCost: ['withoutCost', 'skip'],
  oddVat: ['vat18', 'skip'],
  similar: ['lookAfter', 'asTwo'],
  noCategory: ['other', 'skip'],
  dupPartner: ['keepFirst', 'skipAll'],
};
const PROBLEM_TONE: Record<ProblemKey, 'danger' | 'warn' | 'info' | 'neutral'> = {
  dupBarcode: 'danger',
  barcodeCut: 'warn',
  costAbovePrice: 'warn',
  noPrice: 'warn',
  noCost: 'info',
  oddVat: 'warn',
  similar: 'info',
  noCategory: 'neutral',
  dupPartner: 'warn',
};

export interface Problem {
  key: ProblemKey;
  tone: 'danger' | 'warn' | 'info' | 'neutral';
  count: number;
  choices: string[];
  usual: string;
  chosen: string;
  /** A few rows to show; every row's key, for the download. */
  sample: Array<{ rowKey: string; cells: Array<string | number | null> }>;
  rowKeys: string[];
}

export interface Warning {
  key: 'stockConcentrated' | 'booksStarted' | 'owedKeptInNote';
  /** Figures the dashboard words it with. */
  facts: Record<string, string | number>;
  /** The products behind a stock warning. */
  rows?: Array<{ name: string; stock: number; cost: number; value: number }>;
  choices?: Array<'bring' | 'none'>;
  chosen?: 'bring' | 'none';
}

export interface Preview {
  profile: { id: string; name: string } | null;
  /** What the drop was, for the sentence at the top. */
  shape: 'export' | 'products' | 'priceList' | 'partners' | 'nothing';
  sheets: Array<Omit<SheetPlan, 'signature' | 'activeColumn' | 'soldByScaleColumn'> & { examples: Array<Array<Cell>>; rows: number }>;
  counts: {
    products: { new: number; changed: number; same: number; skipped: number };
    suppliers: { new: number; same: number; skipped: number };
    customers: { new: number; same: number; skipped: number };
    categories: { new: number; total: number };
    barcodes: number;
  };
  stockValue: number;
  owed: { suppliers: number; customers: number };
  changes: Array<{ name: string; field: ProductChangeField; from: string | number | null; to: string | number | null }>;
  problems: Problem[];
  warnings: Warning[];
  /** Rows left out with no decision needed (no name and nothing to match), by reason. */
  leftOut: { noName: number };
}

export interface Plan {
  preview: Preview;
  products: PlannedProduct[];
  partners: PlannedPartner[];
  /** Category names to create. */
  newCategories: string[];
  /** Pairs of rowKeys (or rowKey + existing product id) that look alike, for Possible duplicates. */
  similarPairs: Array<{ a: string; b: string | number; similarity: number }>;
}

// ---------- Recognising the files ----------

const headerSignature = (headers: string[]) => headers.map((h) => normalise(h)).join('|');
const text = (cell: Cell | undefined): string => (cell === null || cell === undefined ? '' : String(cell).trim());

/**
 * Which program made the files and what each sheet holds. Saved layouts (from
 * an earlier file like it) win over guesses; a profile wins over both.
 */
export function recognise(
  sheets: ReadSheet[],
  layouts: Array<{ signature: string; kind: ImportKind; headerRow: number; mapping: Partial<Record<Field, number>> }>,
): Recognised {
  const profile = matchProfile(sheets);
  const out: Recognised = { profile: profile ? { id: profile.id, name: profile.name } : null, sheets: [], leftOut: [], categoryFile: {} };
  sheets.forEach((sheet, index) => {
    const key = `${sheet.file}${sheet.sheet ? `#${sheet.sheet}` : ''}`;
    const base = baseName(sheet.file);
    if (profile) {
      const known = profile.files.find((file) => file.name.test(base) && hasHeadings(sheet.rows[0], file.required));
      if (known) {
        const headers = (sheet.rows[0] ?? []).map(text);
        const mapping: Partial<Record<Field, number>> = {};
        for (const [field, heading] of Object.entries(known.columns)) {
          const at = headers.indexOf(heading);
          if (at >= 0) mapping[field as Field] = at;
        }
        const plan: SheetPlan = { key, index, file: sheet.file, sheet: sheet.sheet, kind: known.kind, kindSure: true, headerRow: 0, headers, mapping, guessed: [], remembered: false, signature: headerSignature(headers) };
        if (known.kind === 'products' && profile.activeWhen) {
          const at = headers.indexOf(profile.activeWhen.column);
          if (at >= 0) plan.activeColumn = { index: at, equals: profile.activeWhen.equals };
        }
        if (known.kind === 'products' && profile.soldByScale) {
          const at = headers.indexOf(profile.soldByScale);
          if (at >= 0) plan.soldByScaleColumn = at;
        }
        out.sheets.push(plan);
        return;
      }
      if (profile.categories?.name.test(base)) {
        const headers = (sheet.rows[0] ?? []).map(text);
        const code = headers.indexOf(profile.categories.code);
        const category = headers.indexOf(profile.categories.category);
        if (code >= 0 && category >= 0) {
          for (const row of sheet.rows.slice(1)) if (text(row[code]) && text(row[category])) out.categoryFile[text(row[code])] = text(row[category]);
          return;
        }
      }
      const leftOut = profile.leftOut.find((rule) => rule.name.test(base));
      if (leftOut) {
        out.leftOut.push({ file: sheet.file, why: leftOut.why });
        return;
      }
    }
    out.sheets.push(guessSheet(sheet, key, index, layouts));
  });
  return out;
}

function hasHeadings(row: Cell[] | undefined, required: string[]): boolean {
  const headers = new Set((row ?? []).map(text));
  return required.every((heading) => headers.has(heading));
}

function matchProfile(sheets: ReadSheet[]): Profile | null {
  for (const profile of PROFILES) {
    if (sheets.some((sheet) => profile.files.some((file) => file.name.test(baseName(sheet.file)) && hasHeadings(sheet.rows[0], file.required)))) return profile;
  }
  return null;
}

/** A sheet 4VD has no profile for: find the heading row, the kind, and each column. */
function guessSheet(sheet: ReadSheet, key: string, index: number, layouts: Parameters<typeof recognise>[1]): SheetPlan {
  // The heading row is the first of the top ten rows that names at least two known fields.
  let best: { row: number; kind: ImportKind; score: number; mapping: Partial<Record<Field, number>>; guessed: Field[] } | null = null;
  for (let row = 0; row < Math.min(10, sheet.rows.length); row++) {
    const cells = sheet.rows[row] ?? [];
    const signature = headerSignature(cells.map(text));
    const saved = layouts.find((layout) => layout.signature === signature);
    if (saved) {
      return { key, index, file: sheet.file, sheet: sheet.sheet, kind: saved.kind, kindSure: true, headerRow: row, headers: cells.map(text), mapping: saved.mapping, guessed: [], remembered: true, signature };
    }
    for (const kind of IMPORT_KINDS) {
      const mapping: Partial<Record<Field, number>> = {};
      const guessed: Field[] = [];
      cells.forEach((cell, column) => {
        if (typeof cell !== 'string') return;
        const field = fieldForHeading(kind, cell);
        if (!field || mapping[field] !== undefined) return;
        mapping[field] = column;
        if (!exactHeading(kind, cell, field)) guessed.push(field);
      });
      let score = Object.keys(mapping).length;
      if (kind === 'products' && (mapping.price !== undefined || mapping.barcode !== undefined || mapping.cost !== undefined)) score += 2;
      if (kind !== 'products' && (mapping.nui !== undefined || mapping.phone !== undefined || mapping.address !== undefined || mapping.owed !== undefined)) score += 2;
      if (kind !== 'products' && (mapping.price !== undefined || mapping.barcode !== undefined)) score -= 5;
      const byName = KIND_BY_FILE_NAME.find(([pattern]) => pattern.test(`${baseName(sheet.file)} ${sheet.sheet ?? ''}`))?.[1];
      if (byName === kind) score += 1;
      if (score >= 3 && (!best || score > best.score)) best = { row, kind, score, mapping, guessed };
    }
  }
  if (!best) {
    return { key, index, file: sheet.file, sheet: sheet.sheet, kind: 'skip', kindSure: false, headerRow: 0, headers: (sheet.rows[0] ?? []).map(text), mapping: {}, guessed: [], remembered: false, signature: headerSignature((sheet.rows[0] ?? []).map(text)) };
  }
  const found = best as { row: number; kind: ImportKind; score: number; mapping: Partial<Record<Field, number>>; guessed: Field[] };
  const headers = (sheet.rows[found.row] ?? []).map(text);
  // Suppliers and customers have the same columns: only the file's name tells them apart.
  const byName = KIND_BY_FILE_NAME.find(([pattern]) => pattern.test(`${baseName(sheet.file)} ${sheet.sheet ?? ''}`))?.[1];
  const kindSure = found.kind === 'products' || byName === found.kind;
  return { key, index, file: sheet.file, sheet: sheet.sheet, kind: found.kind, kindSure, headerRow: found.row, headers, mapping: found.mapping, guessed: found.guessed, remembered: false, signature: headerSignature(headers) };
}

/** The heading is one of the field's known names exactly (not just starting or ending with one). */
function exactHeading(kind: ImportKind, heading: string, field: Field): boolean {
  return (HEADINGS[kind][field] ?? []).includes(normalise(heading));
}

// ---------- Reading the rows ----------

/** A barcode as digits; Excel's "3.80012E+12" (a long number cut short) is flagged. */
export function readBarcode(cell: Cell): { barcode: string | null; cut: boolean } {
  if (cell === null || cell === undefined) return { barcode: null, cut: false };
  if (typeof cell === 'number') return Number.isInteger(cell) && cell > 0 ? { barcode: String(cell), cut: false } : { barcode: null, cut: false };
  const value = cell.trim().replace(/\s/g, '');
  if (!value) return { barcode: null, cut: false };
  if (/^\d+(?:[.,]\d+)?e\+?\d+$/i.test(value)) return { barcode: null, cut: true };
  return { barcode: value.slice(0, 64), cut: false };
}

/** "18", "18%", "0.18", "18,00" → 18; null when there is none. */
export function readVat(cell: Cell): number | null {
  if (cell === null) return null;
  const value = typeof cell === 'number' ? cell : Number(String(cell).replace('%', '').replace(',', '.').trim());
  if (!Number.isFinite(value) || String(cell).trim() === '') return null;
  return value > 0 && value < 1 ? Math.round(value * 100) : Math.round(value);
}

const number = (cell: Cell): number | null => {
  if (cell === null) return null;
  if (typeof cell === 'number') return cell;
  const money = parseMoney(cell);
  return money;
};
const str = (cell: Cell | undefined, max: number): string | null => {
  const value = text(cell);
  return value ? value.slice(0, max) : null;
};

export function readProducts(sheet: ReadSheet, plan: SheetPlan, categoryFile: Record<string, string>): ProductRecord[] {
  const at = (row: Cell[], field: Field): Cell => (plan.mapping[field] === undefined || plan.mapping[field]! < 0 ? null : (row[plan.mapping[field]!] ?? null));
  return sheet.rows.slice(plan.headerRow + 1).map((row, i) => {
    const { barcode, cut } = readBarcode(at(row, 'barcode'));
    const vat = readVat(at(row, 'vat'));
    const rate = vat !== null && VAT_RATES.includes(vat) ? vat : 18;
    const gross = (value: number | null) => (value === null ? null : roundMoney(value * (1 + rate / 100)));
    const price = number(at(row, 'price')) ?? gross(number(at(row, 'priceNet')));
    const cost = number(at(row, 'cost')) ?? gross(number(at(row, 'costNet')));
    const code = str(at(row, 'code'), 100);
    const scale = plan.soldByScaleColumn !== undefined && /^(true|1|po|yes)$/i.test(text(row[plan.soldByScaleColumn]));
    return {
      rowKey: `${plan.index}:${plan.headerRow + 2 + i}`,
      row: plan.headerRow + 2 + i,
      sheet: plan.key,
      code,
      barcode,
      barcodeCut: cut,
      otherBarcodes: text(at(row, 'otherBarcodes'))
        .split(/[,;|\s]+/)
        .map((b) => b.trim())
        .filter((b) => b && b !== barcode && /^[\w-]+$/.test(b))
        .map((b) => b.slice(0, 64)),
      name: str(at(row, 'name'), 255),
      category: (code && categoryFile[code]) || str(at(row, 'category'), 255),
      unit: unitFromTrefin(text(at(row, 'unit')).replace(/^(kilogram|kilogrami|kile)$/i, 'kg').replace(/^(litër|liter|litra|litri)$/i, 'l'), scale),
      price: price === null ? null : roundMoney(price),
      wholesale: number(at(row, 'wholesale')),
      cost: cost === null ? null : roundMoney(cost),
      vat,
      stock: number(at(row, 'stock')),
      reorder: number(at(row, 'reorder')),
      supplier: str(at(row, 'supplier'), 120),
      active: plan.activeColumn ? text(row[plan.activeColumn.index]) === plan.activeColumn.equals : true,
    };
  });
}

export function readPartners(sheet: ReadSheet, plan: SheetPlan): PartnerRecord[] {
  const at = (row: Cell[], field: Field): Cell => (plan.mapping[field] === undefined || plan.mapping[field]! < 0 ? null : (row[plan.mapping[field]!] ?? null));
  return sheet.rows.slice(plan.headerRow + 1).map((row, i) => ({
    rowKey: `${plan.index}:${plan.headerRow + 2 + i}`,
    row: plan.headerRow + 2 + i,
    sheet: plan.key,
    code: str(at(row, 'code'), 40),
    name: str(at(row, 'name'), 120),
    // Only a real 9-digit NUI; old programs fill the box with 0 or 9999 when there is none.
    nui: ((n) => (/^\d{9}$/.test(n) ? n : null))(text(at(row, 'nui')).replace(/\s+/g, '')),
    businessNo: str(at(row, 'businessNo'), 40),
    fiscalNo: str(at(row, 'fiscalNo'), 40),
    vatNo: str(at(row, 'vatNo'), 40),
    phone: str(at(row, 'phone'), 40),
    mobile: str(at(row, 'mobile'), 40),
    email: str(at(row, 'email'), 255),
    address: str(at(row, 'address'), 200),
    city: str(at(row, 'city'), 80),
    iban: str(at(row, 'iban'), 60),
    contact: str(at(row, 'contact'), 120),
    owed: number(at(row, 'owed')),
    // Old programs write 0 for “no limit” and “no discount”; 4VD keeps those empty.
    creditLimit: positive(number(at(row, 'creditLimit'))),
    discount: ((d) => (d !== null && d <= 100 ? d : null))(positive(number(at(row, 'discount')))),
  }));
}

/** A figure above zero, or nothing. */
function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

// ---------- Similar names ----------

const nameKey = (name: string) => normalise(name).replace(/(\d)\s*[.,]\s*(\d)/g, '$1.$2');
function bigrams(value: string): Map<string, number> {
  const out = new Map<string, number>();
  const s = ` ${value} `;
  for (let i = 0; i < s.length - 1; i++) {
    const pair = s.slice(i, i + 2);
    out.set(pair, (out.get(pair) ?? 0) + 1);
  }
  return out;
}
/** How alike two names are, 0..1 (Dice coefficient on letter pairs, after normalising). */
export function similarity(a: string, b: string): number {
  // "Llokum 700gr" and "Llokum 350gr" are two sizes, not one product twice.
  const numbers = (value: string) => (nameKey(value).match(/\d+(?:\.\d+)?/g) ?? []).join(' ');
  if (numbers(a) !== numbers(b)) return 0;
  const x = bigrams(nameKey(a));
  const y = bigrams(nameKey(b));
  let both = 0;
  let total = 0;
  for (const [pair, n] of x) {
    both += Math.min(n, y.get(pair) ?? 0);
    total += n;
  }
  for (const n of y.values()) total += n;
  return total === 0 ? 0 : (2 * both) / total;
}

// ---------- The plan ----------

export function plan(sheets: ReadSheet[], recognised: Recognised, existing: Existing, choices: Choices, categoryGuess: Record<string, string> = {}): Plan {
  const sheetPlans = recognised.sheets.map((sheetPlan) => applyOverride(sheetPlan, choices.sheets?.[sheetPlan.key]));
  const problems = new Map<ProblemKey, { rows: Array<{ rowKey: string; cells: Array<string | number | null> }> }>();
  const flag = (key: ProblemKey, rowKey: string, cells: Array<string | number | null>) => {
    if (!problems.has(key)) problems.set(key, { rows: [] });
    problems.get(key)!.rows.push({ rowKey, cells });
  };
  const chosen = (key: ProblemKey) => {
    const value = choices.problems?.[key];
    return value && PROBLEM_CHOICES[key].includes(value) ? value : PROBLEM_CHOICES[key][0]!;
  };

  // Products
  const byBarcode = new Map<string, ExistingProduct>();
  const bySku = new Map<string, ExistingProduct>();
  for (const product of existing.products) {
    for (const barcode of product.barcodes) byBarcode.set(barcode, product);
    if (product.sku) bySku.set(product.sku, product);
  }
  const records: ProductRecord[] = [];
  let noName = 0;
  for (const sheetPlan of sheetPlans) {
    if (sheetPlan.kind !== 'products') continue;
    const rows = readProducts(sheets[sheetPlan.index]!, sheetPlan, recognised.categoryFile);
    // A category column with one value for every row (TREFIN keeps all in "Të ndryshme") says nothing: sort them instead.
    const named = new Set(rows.map((row) => row.category).filter(Boolean));
    if (rows.length >= 20 && named.size === 1 && Object.keys(recognised.categoryFile).length === 0) for (const row of rows) row.category = null;
    records.push(...rows);
  }
  const fixes = choices.fixes ?? {};
  const seenBarcode = new Map<string, string>();
  const planned: PlannedProduct[] = [];
  const skipped = new Set<string>();
  for (const record of records) {
    const fix = fixes[record.rowKey];
    if (fix?.price !== undefined) record.price = fix.price;
    if (fix?.cost !== undefined) record.cost = fix.cost;
    const match = (record.barcode && byBarcode.get(record.barcode)) || (record.code && bySku.get(record.code)) || null;
    if (!record.name && !match) {
      noName++;
      continue;
    }
    if (record.barcodeCut) flag('barcodeCut', record.rowKey, [record.name, record.code]);
    if (record.barcode) {
      const first = seenBarcode.get(record.barcode);
      if (first !== undefined) flag('dupBarcode', record.rowKey, [record.barcode, first, record.name]);
      else seenBarcode.set(record.barcode, record.name ?? record.code ?? '');
    }
    const category = record.category || (match ? match.category : record.code ? categoryGuess[record.code] : undefined) || categoryGuess[record.rowKey] || null;
    if (!match) {
      if (!(record.price !== null && record.price > 0)) flag('noPrice', record.rowKey, [record.name, record.price]);
      if (record.cost === null || record.cost <= 0) flag('noCost', record.rowKey, [record.name, record.price]);
      if (!category) flag('noCategory', record.rowKey, [record.name, OTHER_CATEGORY]);
    }
    if (record.cost !== null && record.price !== null && record.price > 0 && record.cost > record.price) flag('costAbovePrice', record.rowKey, [record.name, record.price, record.cost]);
    if (record.vat !== null && !VAT_RATES.includes(record.vat)) flag('oddVat', record.rowKey, [record.name, record.vat]);
    planned.push({
      record,
      action: match ? 'same' : 'new',
      existingId: match?.id ?? null,
      changes: [],
      final: { price: 0, cost: null, vat: 18, category: category ?? OTHER_CATEGORY, stock: 0, active: record.active, barcode: record.barcode },
    });
  }
  // The duplicate barcode problem names both rows: mark the first one too, for "skip both".
  if (problems.has('dupBarcode')) {
    const dup = new Set(problems.get('dupBarcode')!.rows.map((row) => row.cells[0] as string));
    const firstKeys = planned.filter((p) => p.record.barcode && dup.has(p.record.barcode)).map((p) => p.record.rowKey);
    const choice = chosen('dupBarcode');
    const laterKeys = new Set(problems.get('dupBarcode')!.rows.map((row) => row.rowKey));
    for (const key of firstKeys) if (choice === 'skipAll' || laterKeys.has(key)) skipped.add(key);
  }
  const skipFor = (key: ProblemKey, skipValue: string) => {
    if (problems.has(key) && chosen(key) === skipValue) for (const row of problems.get(key)!.rows) skipped.add(row.rowKey);
  };
  skipFor('barcodeCut', 'skip');
  skipFor('costAbovePrice', 'skip');
  skipFor('noPrice', 'skip');
  skipFor('noCost', 'skip');
  skipFor('oddVat', 'skip');
  skipFor('noCategory', 'skip');
  const emptyCost = new Set(problems.has('costAbovePrice') && chosen('costAbovePrice') === 'emptyCost' ? problems.get('costAbovePrice')!.rows.map((r) => r.rowKey) : []);

  const books = existing.books;
  const stockAllowed = !books.openingPosted;
  const keepStock = stockAllowed && (choices.stock ?? 'bring') === 'bring';
  const existingCategories = new Set(existing.categories.map((name) => name.toLowerCase()));
  const newCategories = new Set<string>();
  const changes: Preview['changes'] = [];
  const kept = planned.filter((p) => !skipped.has(p.record.rowKey));
  let stockValue = 0;
  let barcodes = 0;
  for (const p of kept) {
    const r = p.record;
    const match = p.existingId !== null ? existing.products.find((e) => e.id === p.existingId)! : null;
    const vat = r.vat !== null && VAT_RATES.includes(r.vat) ? r.vat : (match?.vat ?? 18);
    const cost = emptyCost.has(r.rowKey) ? null : r.cost !== null && r.cost > 0 ? r.cost : null;
    p.final = {
      price: r.price !== null && r.price > 0 ? r.price : (match?.price ?? 0),
      cost: cost ?? (match ? match.cost : null),
      vat,
      category: p.final.category,
      stock: keepStock && !match ? Math.max(0, r.unit === 'piece' ? Math.floor(r.stock ?? 0) : Math.floor((r.stock ?? 0) * 1000) / 1000) : 0,
      active: r.active && (r.price !== null && r.price > 0 ? true : match !== null),
      barcode: r.barcodeCut ? null : r.barcode,
    };
    if (!match) {
      if (!existingCategories.has(p.final.category.toLowerCase())) newCategories.add(p.final.category);
      stockValue += p.final.stock * (p.final.cost ?? 0);
      barcodes += (p.final.barcode ? 1 : 0) + r.otherBarcodes.length;
      continue;
    }
    // A product 4VD has: only what the file says differently changes; stock never does (counts and bills do that).
    const diff = (field: ProductChangeField, from: string | number | null, to: string | number | null) => {
      if (to === null || to === '' || from === to) return;
      p.changes.push({ field, from, to });
    };
    if (r.price !== null && r.price > 0) diff('price', match.price, r.price);
    if (cost !== null) diff('cost', match.cost, cost);
    if (r.wholesale !== null && r.wholesale > 0) diff('wholesale', match.wholesale, roundMoney(r.wholesale));
    if (r.vat !== null && VAT_RATES.includes(r.vat)) diff('vat', match.vat, r.vat);
    if (r.name && normalise(r.name) !== normalise(match.name)) diff('name', match.name, r.name);
    if (r.category && r.category.toLowerCase() !== match.category.toLowerCase()) {
      diff('category', match.category, r.category);
      if (!existingCategories.has(r.category.toLowerCase())) newCategories.add(r.category);
    }
    if (p.changes.length > 0) {
      p.action = 'changed';
      for (const change of p.changes) if (changes.length < 50) changes.push({ name: match.name, ...change });
    }
  }

  // Similar names among the new products, and between a new product and one 4VD has.
  const similarPairs: Plan['similarPairs'] = [];
  const fresh = kept.filter((p) => p.action === 'new' && p.record.name);
  const index = new Map<string, Array<{ key: string | number; name: string; barcode: string | null }>>();
  const bucket = (name: string) => nameKey(name).slice(0, 3);
  for (const product of existing.products) {
    const list = index.get(bucket(product.name)) ?? [];
    list.push({ key: product.id, name: product.name, barcode: product.barcodes[0] ?? null });
    index.set(bucket(product.name), list);
  }
  for (const p of fresh) {
    const list = index.get(bucket(p.record.name!)) ?? [];
    for (const other of list) {
      if (p.final.barcode && other.barcode && p.final.barcode === other.barcode) continue;
      const alike = similarity(p.record.name!, other.name);
      if (alike >= SIMILAR) {
        similarPairs.push({ a: p.record.rowKey, b: other.key, similarity: Math.round(alike * 100) / 100 });
        flag('similar', p.record.rowKey, [p.record.name, other.name, `${Math.round(alike * 100)}%`]);
        break;
      }
    }
    list.push({ key: p.record.rowKey, name: p.record.name!, barcode: p.final.barcode });
    index.set(bucket(p.record.name!), list);
  }
  if (problems.has('similar') && chosen('similar') === 'asTwo') similarPairs.length = 0;

  // Suppliers and customers
  const partners: PlannedPartner[] = [];
  const partnerCounts = { suppliers: { new: 0, same: 0, skipped: 0 }, customers: { new: 0, same: 0, skipped: 0 } };
  const owed = { suppliers: 0, customers: 0 };
  for (const sheetPlan of sheetPlans) {
    if (sheetPlan.kind !== 'suppliers' && sheetPlan.kind !== 'customers') continue;
    const kind = sheetPlan.kind;
    const known = existing[kind];
    const seen = new Map<string, string>();
    for (const record of readPartners(sheets[sheetPlan.index]!, sheetPlan)) {
      if (!record.name) {
        noName++;
        continue;
      }
      const key = record.code ? `c:${record.code}` : `n:${normalise(record.name)}`;
      if (seen.has(key)) {
        flag('dupPartner', record.rowKey, [record.name, seen.get(key)!]);
        if (chosen('dupPartner') === 'skipAll') skipped.add(record.rowKey);
        partnerCounts[kind].skipped++;
        continue;
      }
      seen.set(key, record.name);
      const match =
        known.find((p) => record.code && p.code === record.code) ??
        known.find((p) => record.nui && p.nui === record.nui) ??
        known.find((p) => normalise(p.name) === normalise(record.name!));
      partners.push({ record, kind, action: match ? 'same' : 'new', existingId: match?.id ?? null });
    }
  }
  if (problems.has('dupPartner') && chosen('dupPartner') === 'skipAll') {
    const names = new Set(problems.get('dupPartner')!.rows.map((row) => normalise(String(row.cells[0]))));
    for (const p of partners) if (names.has(normalise(p.record.name!))) skipped.add(p.record.rowKey);
  }
  const keptPartners = partners.filter((p) => !skipped.has(p.record.rowKey));
  for (const p of keptPartners) {
    partnerCounts[p.kind][p.action]++;
    if (p.action === 'new' && p.record.owed) owed[p.kind] += p.record.owed;
  }

  // Warnings
  const warnings: Warning[] = [];
  const freshStock = kept.filter((p) => p.action === 'new' && p.final.stock > 0 && (p.final.cost ?? 0) > 0);
  if (!stockAllowed && planned.some((p) => p.action === 'new' && (p.record.stock ?? 0) > 0)) {
    warnings.push({ key: 'booksStarted', facts: { products: planned.filter((p) => p.action === 'new' && (p.record.stock ?? 0) > 0).length } });
  } else {
    const values = (keepStock ? freshStock : planned.filter((p) => p.action === 'new' && (p.record.stock ?? 0) > 0 && (p.record.cost ?? 0) > 0))
      .map((p) => {
        const stock = keepStock ? p.final.stock : Math.max(0, Math.floor(p.record.stock ?? 0));
        const cost = keepStock ? p.final.cost! : p.record.cost!;
        return { name: p.record.name ?? '', stock, cost, value: roundMoney(stock * cost) };
      })
      .sort((a, b) => b.value - a.value);
    const total = values.reduce((sum, v) => sum + v.value, 0);
    const top = values.slice(0, 10);
    const topValue = top.reduce((sum, v) => sum + v.value, 0);
    if (total >= 1000 && values.length >= 20 && topValue / total >= 0.4) {
      warnings.push({
        key: 'stockConcentrated',
        facts: { total: roundMoney(total), top: top.length, topValue: roundMoney(topValue), percent: Math.round((topValue / total) * 100) },
        rows: top,
        choices: ['bring', 'none'],
        chosen: keepStock ? 'bring' : 'none',
      });
    }
  }
  if ((owed.suppliers !== 0 || owed.customers !== 0) && (books.openingPosted || !books.startDay)) {
    warnings.push({ key: 'owedKeptInNote', facts: { reason: books.openingPosted ? 'posted' : 'noStart' } });
  }

  const productCounts = { new: 0, changed: 0, same: 0, skipped: 0 };
  for (const p of planned) {
    if (skipped.has(p.record.rowKey)) productCounts.skipped++;
    else productCounts[p.action]++;
  }
  const problemList: Problem[] = [...problems.entries()].map(([key, { rows }]) => ({
    key,
    tone: PROBLEM_TONE[key],
    count: rows.length,
    choices: PROBLEM_CHOICES[key],
    usual: PROBLEM_CHOICES[key][0]!,
    chosen: chosen(key),
    sample: rows.slice(0, SAMPLE),
    rowKeys: rows.map((row) => row.rowKey),
  }));
  const order: ProblemKey[] = ['dupBarcode', 'barcodeCut', 'costAbovePrice', 'noPrice', 'oddVat', 'dupPartner', 'similar', 'noCost', 'noCategory'];
  problemList.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  const kinds = new Set(sheetPlans.map((s) => s.kind));
  const shape: Preview['shape'] = recognised.profile
    ? 'export'
    : kinds.has('products')
      ? productCounts.new === 0 && productCounts.changed + productCounts.same > 0
        ? 'priceList'
        : 'products'
      : kinds.has('suppliers') || kinds.has('customers')
        ? 'partners'
        : 'nothing';

  return {
    preview: {
      profile: recognised.profile,
      shape,
      sheets: sheetPlans.map(({ signature: _s, activeColumn: _a, soldByScaleColumn: _b, ...rest }) => ({
        ...rest,
        examples: (sheets[rest.index]?.rows ?? []).slice(rest.headerRow + 1, rest.headerRow + 4),
        rows: Math.max(0, (sheets[rest.index]?.rows.length ?? 0) - rest.headerRow - 1),
      })),
      counts: {
        products: productCounts,
        suppliers: partnerCounts.suppliers,
        customers: partnerCounts.customers,
        categories: { new: newCategories.size, total: new Set(kept.filter((p) => p.action === 'new').map((p) => p.final.category)).size },
        barcodes,
      },
      stockValue: roundMoney(stockValue),
      owed: { suppliers: roundMoney(owed.suppliers), customers: roundMoney(owed.customers) },
      changes,
      problems: problemList,
      warnings,
      leftOut: { noName },
    },
    products: kept,
    partners: keptPartners,
    newCategories: [...newCategories],
    similarPairs,
  };
}

function applyOverride(sheet: SheetPlan, override: SheetOverride | undefined): SheetPlan {
  if (!override) return sheet;
  const mapping = { ...sheet.mapping };
  for (const [field, column] of Object.entries(override.mapping ?? {})) {
    if (column === undefined || column < 0) delete mapping[field as Field];
    else mapping[field as Field] = column;
  }
  return {
    ...sheet,
    kind: override.kind ?? sheet.kind,
    kindSure: override.kind ? true : sheet.kind === 'skip' ? false : sheet.kindSure,
    mapping,
    guessed: override.mapping ? sheet.guessed.filter((field) => !(field in override.mapping!)) : sheet.guessed,
  };
}

/** Notes about files that the dashboard shows in "Reading your files", with the left-out files. */
export function fileHealth(notes: FileNote[], recognised: Recognised): Array<FileNote | { file: string; key: 'leftOut'; why: string }> {
  return [...notes, ...recognised.leftOut.map((item) => ({ file: item.file, key: 'leftOut' as const, why: item.why }))];
}
