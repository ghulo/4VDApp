/*
 * Small decisions the Counter makes on every key and scan, kept apart from the
 * screen so each can be tested: may this many go in the basket, is this
 * typing a hand or the barcode scanner, does this code name one product, and
 * is the cash typed in Pay believable.
 */

import type { Product } from '../../services/types';
import { ApiError } from '../../services/apiClient';
import { isNetworkFailure } from './offlineQueue';

/** Kilos are kept to the gram; pieces stay whole. */
const toGram = (amount: number) => Math.round(amount * 1000) / 1000;

export type NoStockRule = 'block' | 'allow';

/**
 * How many of a product go in the basket when `wanted` should be on the line
 * (with `already` there now) and 4VD thinks `stock` are on the shelf:
 * - fits: all of them, nothing to say;
 * - past: all of them, but 4VD thought there were fewer (the shop allows it,
 *   or an owner or admin is selling), so a quiet warning;
 * - refused: only what the shelf holds (never fewer than already on the line).
 */
export function stockDecision(p: { stock: number; already: number; wanted: number; rule: NoStockRule; oversees: boolean }):
  | { kind: 'fits'; quantity: number }
  | { kind: 'past'; quantity: number }
  | { kind: 'refused'; quantity: number } {
  const wanted = toGram(p.wanted);
  if (wanted <= p.stock) return { kind: 'fits', quantity: wanted };
  if (p.rule === 'allow' || p.oversees) return { kind: 'past', quantity: wanted };
  return { kind: 'refused', quantity: toGram(Math.max(p.already, Math.min(wanted, Math.max(0, p.stock)))) };
}

/** Keys closer together than this come from the barcode scanner, not a hand. */
export const SCANNER_GAP_MS = 60;
/** Some scanners wait a little before their Enter (a "suffix delay"): still the scan, up to this long. */
export const SCAN_SUFFIX_MS = 1000;
/** Keys typed with gaps under this belong to one run (a slow scanner's code, or an amount typed by hand). */
export const RUN_GAP_MS = 1000;
/** Keys the scanner presses along the way (capitals) that are not part of the code. */
const PASS_THROUGH = new Set(['Shift', 'CapsLock']);

/**
 * Watches the keys typed in a form and tells a barcode scanner's burst (a
 * code typed in a few milliseconds, then Enter) from a hand. Feed it every
 * keydown; on Enter it says what was typed just before and whether it came
 * as a burst: at least two characters, each within 60 ms of the last, and
 * the Enter within a second (some scanners wait before it). Whether a burst is a product is for the caller to
 * check (a fast hand can type a burst too). `run` is everything typed
 * without a pause of a second, however slowly: a slow scanner's whole code.
 */
export class BurstWatcher {
  private chars: string[] = [];
  private run: string[] = [];
  private last = Number.NEGATIVE_INFINITY;

  /** A key went down at `time` (the event's timeStamp). On Enter: what came before it, whether it was a burst, and the run it ends. */
  key(key: string, time: number): { code: string; burst: boolean; run: string } | null {
    if (PASS_THROUGH.has(key)) return null;
    const gap = time - this.last;
    this.last = time;
    if (key === 'Enter') {
      const typed = this.chars;
      const run = this.run;
      this.chars = [];
      this.run = [];
      if (typed.length === 0) return null;
      return { code: typed.join(''), burst: typed.length >= 2 && gap < SCAN_SUFFIX_MS, run: run.join('') };
    }
    if (key.length !== 1) {
      this.chars = [];
      this.run = [];
      return null;
    }
    this.chars = gap < SCANNER_GAP_MS ? [...this.chars, key] : [key];
    this.run = gap < RUN_GAP_MS ? [...this.run, key] : [key];
    return null;
  }

  /** Whether a key at `time` starts a new run (the one before came a second or more ago, or there is none). */
  startsRun(time: number): boolean {
    return this.run.length === 0 || time - this.last >= RUN_GAP_MS;
  }

  /** How many characters of a burst have arrived so far (1 for a single hand-typed key). */
  get length(): number {
    return this.chars.length;
  }
}

/** An Enter this soon after a scan's own Enter is the scanner's second one (CR+LF, or a double Enter), not a hand asking to pay. */
export const DOUBLE_ENTER_MS = 150;

/**
 * What an Enter in Pay means, from what came just before it:
 * - product: the scanner read a product on this shelf; it goes back to the basket and the cash stays as it was;
 * - unknown: it came as fast as a scanner but is no product here (a code this
 *   till doesn't know, or a very fast hand): the cash goes back as it was and
 *   nothing is recorded until the cashier says go on. Keys can't tell a short
 *   scan from a quick hand, so this side never guesses "cash";
 * - maybe: typed slowly (a slow scanner, one that waits long before its Enter,
 *   or a one-character code) but exactly a product's code: nothing is recorded
 *   until the cashier says which it was. A hand typing an amount that is also a
 *   product's number ("7") is asked once: the price of never taking a scan as cash;
 * - pay: typed by a hand: Record sale.
 */
export function payEnter(
  typed: { code: string; burst: boolean; run?: string } | null,
  isProductCode: (code: string) => boolean,
): { kind: 'product' | 'unknown' | 'maybe'; code: string } | { kind: 'pay' } {
  if (!typed) return { kind: 'pay' };
  if (typed.burst) {
    const code = typed.code.trim();
    return isProductCode(code) ? { kind: 'product', code } : { kind: 'unknown', code };
  }
  const run = (typed.run ?? typed.code).trim();
  return run !== '' && isProductCode(run) ? { kind: 'maybe', code: run } : { kind: 'pay' };
}

/**
 * Cash typed in Pay that is almost surely a mistake (a barcode scanned into
 * the box, a key held down): far more change than anyone gives. It needs a
 * second press to record.
 */
export function tenderedLooksWrong(given: number, due: number): boolean {
  const change = given - due;
  if (change > 500) return true;
  return due > 0 && given > due * 20 && change > 100;
}

/** The product a code names exactly on this shelf: a barcode (main or other) first, then its own number (SKU). */
export function exactMatch(code: string, shelf: readonly Product[]): Product | undefined {
  const barcode = shelf.find((product) => product.barcode === code || product.otherBarcodes.includes(code));
  if (barcode) return barcode;
  // The number exactly as typed; another case only when just one product has it (as the server does).
  const exact = shelf.filter((product) => product.sku === code);
  if (exact.length > 0) return exact.length === 1 ? exact[0] : undefined;
  const lower = code.toLowerCase();
  const other = shelf.filter((product) => product.sku !== null && product.sku.toLowerCase() === lower);
  return other.length === 1 ? other[0] : undefined;
}

/**
 * Products whose name holds what was typed, and whether the one match may go
 * in the basket at once. Digits only, or fewer than three letters, never add
 * anything by name: a wrong barcode could sit inside a name ("500" in
 * "Coca-Cola 500 ml"), so those open the finder instead.
 */
export function nameMatches(code: string, shelf: readonly Product[]): { products: Product[]; addAtOnce: boolean } {
  const lower = code.trim().toLowerCase();
  if (!lower) return { products: [], addAtOnce: false };
  const products = shelf.filter((product) => product.name.toLowerCase().includes(lower));
  const letters = (lower.match(/\p{L}/gu) ?? []).length;
  return { products, addAtOnce: products.length === 1 && letters >= 3 };
}

/** Why a barcode lookup on the server failed: no product has it, or 4VD couldn't ask (no internet, server down, other trouble). */
export function lookupFailure(error: unknown): 'notFound' | 'offline' | 'error' {
  // 400: the server says it can't be a barcode at all (too short, odd characters), so no product has it either.
  if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return 'notFound';
  if (isNetworkFailure(error)) return 'offline';
  return 'error';
}

/**
 * What a failed Record sale means for the sale on its way:
 * - refused: nothing was recorded and never will be, so the basket is free again;
 * - offline: it never got there, or no answer came in time: it may or may not be in;
 * - otherOwner: someone else is signed in now: nothing was recorded, and the
 *   sale waits as it is for the person and business that made it;
 * - unclear: anything else: it may or may not be in.
 * The server closes a sale's key when it says no to it (SALE_CLOSED), so no
 * copy still on its way can go in after: that is the only answer that frees a
 * sale sent before. A first send turned away before 4VD looked at the sale
 * (a sign-in that ran out, a bad request) was never recorded either, and no
 * other copy of it exists; a timeout or "too many requests" says nothing.
 * The others keep the same sale and key for Send it again.
 */
export function payFailure(error: unknown, again = false): 'refused' | 'offline' | 'unclear' | 'otherOwner' {
  if (isNetworkFailure(error)) return 'offline';
  if (!(error instanceof ApiError)) return 'unclear';
  if (error.code === 'OWNER_CHANGED') return 'otherOwner';
  if (error.code === 'SALE_CLOSED') return 'refused';
  if (again) return 'unclear';
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429 ? 'refused' : 'unclear';
}

/**
 * Whether the shop's stock rule lets this basket be sold now, by this person:
 * - over: a line holds more than 4VD thinks is on the shelf;
 * - unknown: 4VD can't tell how many are left (the product list didn't load), so it can't check: no.
 * Owners and admins, or the rule "allow", always may.
 */
export function basketStockProblem(
  lines: ReadonlyArray<{ productId: number; name: string; quantity: number; product: Product | undefined }>,
  rule: NoStockRule,
  oversees: boolean,
): { kind: 'over'; product: Product; quantity: number } | { kind: 'unknown'; name: string } | null {
  if (rule === 'allow' || oversees) return null;
  for (const line of lines) {
    if (!line.product) return { kind: 'unknown', name: line.name };
    if (line.quantity > line.product.stock.quantity) return { kind: 'over', product: line.product, quantity: line.quantity };
  }
  return null;
}
