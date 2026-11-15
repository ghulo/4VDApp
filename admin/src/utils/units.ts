import type { ProductUnit } from '../services/types';

/** A measured product (kilo, litre, metre, square metre) moves in parts, to three decimals; a piece only in whole numbers. Same rule as the server's. */
export const allowsParts = (unit: ProductUnit | undefined): boolean => unit !== undefined && unit !== 'piece';

/** The short sign after a measured quantity or price ("0.775 kg", "€2.40 / m²"); none for a piece. */
export function unitSymbol(unit: ProductUnit | undefined): string {
  switch (unit) {
    case 'kg':
      return 'kg';
    case 'l':
      return 'L';
    case 'm':
      return 'm';
    case 'm2':
      return 'm²';
    default:
      return '';
  }
}

/** How many pieces a scanned code adds: a pack barcode's size, else one. */
export const piecesFor = (product: { packs?: Array<{ barcode: string; size: number }> }, code: string): number =>
  product.packs?.find((pack) => pack.barcode === code)?.size ?? 1;
