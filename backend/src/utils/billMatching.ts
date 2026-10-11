import type { BillReading } from '../services/ai/billReader.js';
import { roundMoney } from './money.js';

export interface MatchableProduct {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  costPrice: number | null;
  vatRate: number;
}

/** What 4VD remembers about one supplier code from earlier bills. */
export interface KnownCode {
  productId: number;
  unitsPerPack: number;
}

/** The one thing to look at on a line, most important first. */
export type LineStamp = 'new' | 'unsure' | 'barcode' | 'price' | 'match';

export interface LineMatch {
  productId: number | null;
  matchedBy: 'code' | 'barcode' | 'sku' | 'name' | null;
  unitsPerPack: number;
  /** Pieces going onto the shelf: the bill's quantity times units per pack. */
  pieces: number;
  /** What one piece costs, without VAT and after the line's rabat; null when the bill shows no price. */
  unitCost: number | null;
  /** The product's cost before this bill, when it differs. */
  oldCost: number | null;
  /** The product's barcode, when the bill prints a different one. */
  oldBarcode: string | null;
  stamp: LineStamp;
}

/** A name match this close is taken as the same product; below it, someone confirms. */
const SURE_NAME = 0.8;
const POSSIBLE_NAME = 0.5;
/** Cents of rounding between the lines and the printed total are fine. */
const TOTAL_TOLERANCE = 0.05;

/** Lowercase, without Albanian accents, as a set of words. */
function words(text: string): Set<string> {
  const plain = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ');
  return new Set(plain.split(' ').filter((word) => word.length >= 2));
}

/** How alike two product names are, from 0 (nothing shared) to 1 (same words). */
export function nameSimilarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / (left.size + right.size - shared);
}

const sameCode = (a: string | null, b: string | null) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

type ReadLine = BillReading['lines'][number];

/** One piece's cost without VAT, after rabat. */
export function pieceCost(line: ReadLine, unitsPerPack: number, pricesIncludeVat: boolean, fallbackVat: number): number | null {
  const unitPrice = line.unitPrice ?? (line.lineTotal !== null && line.quantity > 0 ? line.lineTotal / line.quantity : null);
  if (unitPrice === null) return null;
  const afterRabat = unitPrice * (1 - (line.discountPercent ?? 0) / 100);
  const withoutVat = pricesIncludeVat ? afterRabat / (1 + (line.vatRate ?? fallbackVat) / 100) : afterRabat;
  return roundMoney(withoutVat / unitsPerPack);
}

/** Finds the product a bill line is about, and what differs from what 4VD knows. */
export function matchLine(
  line: ReadLine,
  reading: Pick<BillReading, 'pricesIncludeVat'>,
  products: MatchableProduct[],
  codes: Map<string, KnownCode>,
): LineMatch {
  const known = line.code ? codes.get(line.code.trim().toLowerCase()) : undefined;
  let product: MatchableProduct | undefined;
  let matchedBy: LineMatch['matchedBy'] = null;
  let sure = true;

  if (known) {
    product = products.find((row) => row.id === known.productId);
    if (product) matchedBy = 'code';
  }
  if (!product && line.barcode) {
    product = products.find((row) => sameCode(row.barcode, line.barcode));
    if (product) matchedBy = 'barcode';
  }
  if (!product && line.code) {
    product = products.find((row) => sameCode(row.sku, line.code) || sameCode(row.barcode, line.code));
    if (product) matchedBy = 'sku';
  }
  if (!product) {
    let best = 0;
    for (const row of products) {
      const score = nameSimilarity(line.name, row.name);
      if (score > best) {
        best = score;
        product = row;
      }
    }
    if (best < POSSIBLE_NAME) product = undefined;
    else {
      matchedBy = 'name';
      sure = best >= SURE_NAME;
    }
  }

  const unitsPerPack = known?.unitsPerPack ?? (line.unitsPerPack && line.unitsPerPack > 1 ? Math.round(line.unitsPerPack) : 1);
  const unitCost = pieceCost(line, unitsPerPack, reading.pricesIncludeVat, product?.vatRate ?? 18);
  const oldCost = product && unitCost !== null && product.costPrice !== unitCost ? product.costPrice : null;
  const oldBarcode = product && line.barcode && !sameCode(product.barcode, line.barcode) ? product.barcode : null;
  const barcodeDiffers = Boolean(product && line.barcode && !sameCode(product.barcode, line.barcode));

  return {
    productId: product?.id ?? null,
    matchedBy,
    unitsPerPack,
    pieces: Math.round(line.quantity * unitsPerPack),
    unitCost,
    oldCost,
    oldBarcode,
    stamp: !product ? 'new' : !sure ? 'unsure' : barcodeDiffers ? 'barcode' : oldCost !== null || (product.costPrice === null && unitCost !== null) ? 'price' : 'match',
  };
}

/** The lines added up against the total printed on the bill. */
export function checkTotals(reading: BillReading): { linesTotal: number; printedTotal: number | null; adds: boolean } {
  const linesTotal = roundMoney(
    reading.lines.reduce(
      (sum, line) => sum + (line.lineTotal ?? (line.unitPrice ?? 0) * line.quantity * (1 - (line.discountPercent ?? 0) / 100)),
      0,
    ),
  );
  // Line totals are printed the same way as the unit prices: with VAT or without.
  const printedTotal = reading.pricesIncludeVat ? reading.totals.gross : (reading.totals.net ?? reading.totals.gross);
  return { linesTotal, printedTotal, adds: printedTotal === null || Math.abs(linesTotal - printedTotal) <= TOTAL_TOLERANCE };
}
