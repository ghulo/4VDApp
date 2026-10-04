import { TEAM_APP_URL } from '../auth/finishSignIn';

/**
 * A product's QR code holds a link into the team app, so any phone camera
 * can open the product: https://app.4vd.app/scan/2000000000039. Same rules
 * as the team app's utils/scanLinks.ts.
 */
const SCAN_PATH = /\/scan\/([^/?#]+)/;

export const scanUrl = (code: string) => `${TEAM_APP_URL}/scan/${encodeURIComponent(code)}`;

/** The product code in a scanned value: the code itself, or the code inside a scan link. */
export function codeFromScan(value: string): string {
  const match = SCAN_PATH.exec(value);
  return match ? decodeURIComponent(match[1]!) : value.trim();
}
