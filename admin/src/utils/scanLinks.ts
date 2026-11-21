/**
 * A product's QR code holds a link into 4VD, so any phone camera
 * can open the product: https://4vd.app/scan/2000000000039 (older labels say app.4vd.app,
 * which redirects here). Same rules
 */
const SCAN_PATH = /\/scan\/([^/?#]+)/;

export const scanUrl = (code: string) => `${window.location.origin}/scan/${encodeURIComponent(code)}`;

/** The product code in a scanned value: the code itself, or the code inside a scan link. */
export function codeFromScan(value: string): string {
  const match = SCAN_PATH.exec(value);
  return match ? decodeURIComponent(match[1]!) : value.trim();
}

/** An invoice or credit note number as its printed barcode reads, e.g. "F-2026-000042" or "FSM-26-000042"; null for anything else. */
export function documentNumberFromScan(value: string): string | null {
  const text = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,6}-(\d{2}|\d{4})-\d{3,9}$/.test(text) ? text : null;
}
