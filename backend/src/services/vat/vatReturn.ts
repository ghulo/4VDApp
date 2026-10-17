import { roundMoney } from '../../utils/money.js';
import { vatOf } from '../books/entryBuilder.js';

/**
 * ATK's monthly VAT return (form "TV"), boxes 9 to 72, worked out from the
 * shop's documents. Each document becomes one `VatItem` carrying what it puts
 * in each box; the sales book, the purchase book, every box's "documents
 * behind it" and the return's totals all read the same items, so they can
 * never disagree.
 *
 * Where a figure goes, in plain terms:
 * - Sales (till days and invoices): exempt → 9, 0% → 10, 18% and the old 16%
 *   → 12/13, 8% → 14/15. Box 11 (exports) stays empty: the shop doesn't export.
 * - A customer's return (a credit note the shop issues) lowers the VAT charged
 *   the way the form asks: 18% → 53/54, 8% → 55/56 (0% and exempt lower 10/9).
 * - Bills from suppliers in Kosovo: 18%/16% → 43/44, 8% → 45/46, equipment
 *   → 47/48 and 49/50, no VAT → 31 (equipment 32).
 * - Imports: the VAT paid at customs, spread over the goods by value and rate:
 *   35/36, 37/38, equipment 39/40 and 41/42. Without customs VAT → 31/32.
 * - A service from abroad, VAT charged to yourself: 28/29 and 65/66.
 * - A return or credit from a supplier (a credit note the shop receives):
 *   18% → 16/17, 8% → 18/19; one without VAT lowers 31/32.
 * - Wages and taxes paid are not purchases and stay off the return.
 * - Bad debt (20-23, 57-60), other adjustments (24-27, 61-64), non-deductible
 *   VAT (33/34) and farmers (51/52) are not used by the shop yet and stay 0.
 */

/** A pair of boxes on one line of the form: what it is on (base) and its VAT. */
export interface VatRowDef {
  key: string;
  base: number;
  vat?: number;
}

export const CHARGED_ROWS: VatRowDef[] = [
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
];

export const CLAIM_ROWS: VatRowDef[] = [
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
];

const CHARGED_VAT_BOXES = CHARGED_ROWS.flatMap((row) => (row.vat ? [row.vat] : []));
const CLAIM_VAT_BOXES = CLAIM_ROWS.flatMap((row) => (row.vat ? [row.vat] : []));
/** Boxes the sales book shows, the purchase book the rest (a service from abroad is in both). */
export const SALES_BOOK_BOXES = new Set(CHARGED_ROWS.flatMap((row) => [row.base, ...(row.vat ? [row.vat] : [])]));
export const PURCHASE_BOOK_BOXES = new Set(CLAIM_ROWS.flatMap((row) => [row.base, ...(row.vat ? [row.vat] : [])]));

export type Boxes = Partial<Record<number, number>>;

export type VatItemKind = 'invoice' | 'till_day' | 'return' | 'bill' | 'credit';

/** One document as the VAT return sees it. */
export interface VatItem {
  kind: VatItemKind;
  /** The document's id; a till day's date. */
  ref: string;
  date: string;
  number: string | null;
  party: string | null;
  nui: string | null;
  /** What it puts in each box. */
  boxes: Boxes;
  /** A bill dated in an earlier month that was already filed, counted here instead. */
  lateFrom?: string;
  /** For a till day or return: how many sales or units it stands for. */
  count?: number;
}

export function addTo(boxes: Boxes, box: number, amount: number): void {
  if (amount === 0) return;
  boxes[box] = roundMoney((boxes[box] ?? 0) + amount);
}

/** The base and VAT boxes for a sale or a customer's return at this rate. */
export function saleBoxes(boxes: Boxes, gross: number, rate: number, exempt: boolean, sign: 1 | -1): void {
  if (exempt) return addTo(boxes, 9, sign * gross);
  if (rate === 0) return addTo(boxes, 10, sign * gross);
  const vat = vatOf(gross, rate);
  if (sign === 1) {
    addTo(boxes, rate === 8 ? 14 : 12, roundMoney(gross - vat));
    addTo(boxes, rate === 8 ? 15 : 13, vat);
  } else {
    addTo(boxes, rate === 8 ? 55 : 53, roundMoney(gross - vat));
    addTo(boxes, rate === 8 ? 56 : 54, vat);
  }
}

/** A purchase from a supplier in Kosovo at this rate. */
export function localPurchaseBoxes(boxes: Boxes, net: number, vat: number, rate: number, equipment: boolean): void {
  if (vat === 0 || rate === 0) return addTo(boxes, equipment ? 32 : 31, net);
  if (rate === 8) {
    addTo(boxes, equipment ? 49 : 45, net);
    addTo(boxes, equipment ? 50 : 46, vat);
  } else {
    addTo(boxes, equipment ? 47 : 43, net);
    addTo(boxes, equipment ? 48 : 44, vat);
  }
}

/** Goods brought in from abroad, with their share of the VAT paid at customs. */
export function importBoxes(boxes: Boxes, base: number, customsVat: number, rate: number, equipment: boolean): void {
  if (customsVat === 0) return addTo(boxes, equipment ? 32 : 31, base);
  if (rate === 8) {
    addTo(boxes, equipment ? 41 : 37, base);
    addTo(boxes, equipment ? 42 : 38, customsVat);
  } else {
    addTo(boxes, equipment ? 39 : 35, base);
    addTo(boxes, equipment ? 40 : 36, customsVat);
  }
}

/** A return or credit from a supplier: the purchase's boxes turned into the credit-note boxes of the VAT charged. */
export function asSupplierCredit(purchase: Boxes): Boxes {
  const boxes: Boxes = {};
  for (const [key, amount] of Object.entries(purchase)) {
    const box = Number(key);
    if (!amount) continue;
    if (box === 31 || box === 32) addTo(boxes, box, -amount);
    else if (box === 28 || box === 29 || box === 65 || box === 66) addTo(boxes, box, -amount);
    else if ([37, 38, 41, 42, 45, 46, 49, 50].includes(box)) addTo(boxes, box % 2 === 1 ? 18 : 19, amount);
    else addTo(boxes, box % 2 === 1 ? 16 : 17, amount);
  }
  return boxes;
}

export interface VatResult {
  /** Every box 9-72, zeros included. */
  boxes: Record<number, number>;
  /** "pay": box 72 is owed by the 20th of next month; "carry": box 71 goes to next month; "nothing": both are 0. */
  outcome: 'pay' | 'carry' | 'nothing';
}

/**
 * The return's totals and its result from the documents' boxes, the credit
 * carried in (68) and the refund asked for (70). A refund can't be more than
 * the credit (69); it is capped there.
 */
export function vatResult(items: VatItem[], carriedIn: number, refundAsked: number): VatResult {
  const boxes: Record<number, number> = {};
  for (let box = 9; box <= 72; box += 1) boxes[box] = 0;
  for (const item of items) for (const [box, amount] of Object.entries(item.boxes)) boxes[Number(box)] = roundMoney(boxes[Number(box)]! + (amount ?? 0));
  boxes[30] = roundMoney(CHARGED_VAT_BOXES.reduce((sum, box) => sum + boxes[box]!, 0));
  boxes[67] = roundMoney(CLAIM_VAT_BOXES.reduce((sum, box) => sum + boxes[box]!, 0));
  boxes[68] = roundMoney(carriedIn);
  boxes[69] = roundMoney(Math.max(boxes[67] + boxes[68] - boxes[30], 0));
  boxes[70] = roundMoney(Math.min(refundAsked, boxes[69]));
  boxes[71] = roundMoney(boxes[69] - boxes[70]);
  boxes[72] = roundMoney(Math.max(boxes[30] - boxes[67] - boxes[68], 0));
  const outcome = boxes[72] > 0 ? 'pay' : boxes[71] > 0 ? 'carry' : 'nothing';
  return { boxes, outcome };
}

/** VAT a document claims back (its purchase-side VAT boxes). */
export const claimedVat = (item: VatItem) => roundMoney(CLAIM_VAT_BOXES.reduce((sum, box) => sum + (item.boxes[box] ?? 0), 0));
/** VAT a document charges (its sales-side VAT boxes). */
export const chargedVat = (item: VatItem) => roundMoney(CHARGED_VAT_BOXES.reduce((sum, box) => sum + (item.boxes[box] ?? 0), 0));
