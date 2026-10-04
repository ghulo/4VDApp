/**
 * Product QR codes hold a link like https://app.4vd.app/scan/2000000000039,
 * so any phone camera can open the product. Inside the app's own scanner the
 * same link just means "this barcode".
 */
const SCAN_PATH = /\/scan\/([^/?#]+)/;

/** The product code in a scanned value: the code itself, or the code inside a scan link. */
export function codeFromScan(value: string): string {
  const match = SCAN_PATH.exec(value);
  return match ? decodeURIComponent(match[1]!) : value.trim();
}

/**
 * A code from the address the app was opened with (web only), taken once.
 * Kept until after sign-in, so a QR scanned while logged out still opens its product.
 */
// In a browser there's an address; in the native apps window.location doesn't exist.
const onWeb = typeof window !== 'undefined' && typeof window.location?.pathname === 'string';
let pending: string | null = onWeb ? (SCAN_PATH.exec(window.location.pathname)?.[1] ?? null) : null;

export function takePendingScan(): string | null {
  const code = pending === null ? null : decodeURIComponent(pending);
  pending = null;
  // Back to the plain address, so a refresh doesn't open the product again.
  if (code !== null && onWeb) window.history.replaceState(null, '', '/');
  return code;
}
