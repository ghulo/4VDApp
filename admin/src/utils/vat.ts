import type { VatItem } from '../services/types';
import { formatDateWith } from './format';

/**
 * The lines of ATK's VAT return (form "TV"), as the server works them out
 * (backend/src/services/vat/vatReturn.ts): each line's amount box and, for
 * taxed lines, its VAT box.
 */
export interface VatRowDef {
  key: string;
  base: number;
  vat?: number;
}

export const CHARGED_ROWS = [
  { key: 'exemptNoCredit', base: 9 },
  { key: 'exemptWithCredit', base: 10 },
  { key: 'exports', base: 11 },
  { key: 'sales18', base: 12, vat: 13 },
  { key: 'sales8', base: 14, vat: 15 },
  { key: 'notes18', base: 16, vat: 17 },
  { key: 'notes8', base: 18, vat: 19 },
  { key: 'badDebt18', base: 20, vat: 21 },
  { key: 'badDebt8', base: 22, vat: 23 },
  { key: 'raise18', base: 24, vat: 25 },
  { key: 'raise8', base: 26, vat: 27 },
  { key: 'reverseCharge', base: 28, vat: 29 },
] as const satisfies readonly VatRowDef[];

export const CLAIM_ROWS = [
  { key: 'noVat', base: 31 },
  { key: 'equipmentNoVat', base: 32 },
  { key: 'nonDeductible', base: 33 },
  { key: 'equipmentNonDeductible', base: 34 },
  { key: 'imports18', base: 35, vat: 36 },
  { key: 'imports8', base: 37, vat: 38 },
  { key: 'equipmentImports18', base: 39, vat: 40 },
  { key: 'equipmentImports8', base: 41, vat: 42 },
  { key: 'local18', base: 43, vat: 44 },
  { key: 'local8', base: 45, vat: 46 },
  { key: 'equipmentLocal18', base: 47, vat: 48 },
  { key: 'equipmentLocal8', base: 49, vat: 50 },
  { key: 'farmers', base: 51, vat: 52 },
  { key: 'notes18', base: 53, vat: 54 },
  { key: 'notes8', base: 55, vat: 56 },
  { key: 'badDebt18', base: 57, vat: 58 },
  { key: 'badDebt8', base: 59, vat: 60 },
  { key: 'lower18', base: 61, vat: 62 },
  { key: 'lower8', base: 63, vat: 64 },
  { key: 'reverseCharge', base: 65, vat: 66 },
] as const satisfies readonly VatRowDef[];

export type BookKind = 'sales' | 'purchases';
const ROWS: Record<BookKind, readonly VatRowDef[]> = { sales: CHARGED_ROWS, purchases: CLAIM_ROWS };
export const VAT_18: Record<BookKind, number[]> = { sales: [13, 17, 21, 25, 29], purchases: [36, 40, 44, 54, 58, 62, 66] };
export const VAT_8: Record<BookKind, number[]> = { sales: [15, 19, 23, 27], purchases: [38, 42, 46, 50, 52, 56, 60, 64] };

/** A book's box columns in the form's order: each line's amount, then its VAT. */
export const bookBoxes = (kind: BookKind) => ROWS[kind].flatMap((row) => [row.base, ...(row.vat ? [row.vat] : [])]);

export const boxSum = (item: VatItem, boxes: readonly number[]) => Math.round(boxes.reduce((sum, box) => sum + (item.boxes[box] ?? 0), 0) * 100) / 100;

/** The documents in a book: any with an amount in its boxes. */
export const bookItems = (kind: BookKind, items: VatItem[]) => {
  const boxes = bookBoxes(kind);
  return items.filter((item) => boxes.some((box) => (item.boxes[box] ?? 0) !== 0));
};

/** A sales book's total (amounts and VAT), or a purchase book's total before VAT. */
export function bookTotal(kind: BookKind, item: VatItem): number {
  const bases = ROWS[kind].map((row) => row.base);
  const vat = ROWS[kind].flatMap((row) => (row.vat ? [row.vat] : []));
  return kind === 'sales' ? Math.round((boxSum(item, bases) + boxSum(item, vat)) * 100) / 100 : boxSum(item, bases);
}

/** "2026-09" this month, in the shop's calendar as the browser sees it. */
export function thisMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** "September 2026", in the reader's language. */
export const formatMonth = (month: string) => formatDateWith(new Date(`${month}-15T12:00:00`), { month: 'long', year: 'numeric' });

export function addMonths(month: string, count: number): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, monthNumber - 1 + count, 1));
  return date.toISOString().slice(0, 7);
}

/** Where a document in the VAT figures opens. */
export function itemLink(item: VatItem): string | null {
  if (item.kind === 'invoice') return `/documents/${item.ref}`;
  if (item.kind === 'bill' || item.kind === 'credit') return `/bills/${item.ref}`;
  if (item.kind === 'till_day') return `/sales?period=custom&from=${item.ref}&to=${item.ref}`;
  return null;
}
