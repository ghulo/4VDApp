/**
 * Barcodes. Shop-made ones are EAN-13 numbers starting with 2, the range set
 * aside for in-store use, so they can never clash with a manufacturer's code.
 */

/** The last digit of a GTIN (EAN-8, UPC-A, EAN-13, ITF-14) from the digits before it. */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  // From the right, digits alternate weight 3 and 1.
  for (let index = 0; index < body.length; index += 1) {
    const digit = Number(body[body.length - 1 - index]);
    sum += index % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/** True for codes that aren't GTINs (letters, other lengths), and for GTINs whose check digit is right. */
export function hasValidCheckDigit(code: string): boolean {
  if (!/^\d+$/.test(code) || !GTIN_LENGTHS.has(code.length)) return true;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/**
 * A shop-made EAN-13 for a product: "2", a try number (0–9, for the rare clash
 * with a code typed in by hand), the product id in 10 digits, and the check digit.
 */
export function inStoreBarcode(productId: number, attempt = 0): string {
  const body = `2${attempt}${String(productId).padStart(10, '0')}`;
  return `${body}${gtinCheckDigit(body)}`;
}
