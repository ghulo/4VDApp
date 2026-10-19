/*
 * The shop scale's labels: an EAN-13 starting with 2, then one more digit
 * (the scale's prefix), the product's 5-digit PLU, the weight in grams in 5
 * digits, and the check digit. "21 01234 01250 7" is PLU 1234, 1.250 kg.
 */

export interface ScaleLabel {
  plu: number;
  /** Kilograms, to the gram. */
  kg: number;
}

/** The EAN-13 check digit for the first twelve digits. */
export function eanCheckDigit(first12: string): number {
  let sum = 0;
  for (let index = 0; index < 12; index++) sum += Number(first12[index]) * (index % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** The PLU and weight in a scale label, or null when the code isn't one (or misread). */
export function readScaleLabel(code: string): ScaleLabel | null {
  if (!/^2\d{12}$/.test(code)) return null;
  if (eanCheckDigit(code.slice(0, 12)) !== Number(code[12])) return null;
  const plu = Number(code.slice(2, 7));
  const grams = Number(code.slice(7, 12));
  if (plu === 0 || grams === 0) return null;
  return { plu, kg: grams / 1000 };
}
