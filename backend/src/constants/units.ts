import type { ProductUnit } from '../database/types.js';

/** How a product is sold: whole pieces, or measured (weighed by the kilo, by the litre, the metre or the square metre). */
export const PRODUCT_UNITS = ['piece', 'kg', 'l', 'm', 'm2'] as const;

/** A measured product moves in parts (to three decimals); a piece only in whole numbers. */
export const allowsParts = (unit: ProductUnit | undefined): boolean => unit !== undefined && unit !== 'piece';

/** TREFIN's unit names (tblArtikujt_Njesia) as 4VD's; anything else is sold by the piece. */
export function unitFromTrefin(name: string, soldByScale: boolean): ProductUnit {
  const unit = name.trim().toLowerCase();
  if (soldByScale || unit === 'kg') return 'kg';
  if (unit === 'l') return 'l';
  if (unit === 'm') return 'm';
  if (unit === 'm²' || unit === 'm2') return 'm2';
  return 'piece';
}
