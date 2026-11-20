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
export const SCAN_SUFFIX_MS = 300;
/** Keys the scanner presses along the way (capitals) that are not part of the code. */
const PASS_THROUGH = new Set(['Shift', 'CapsLock']);

/**
 * Watches the keys typed in a form and tells a barcode scanner's burst (a
 * code typed in a few milliseconds, then Enter) from a hand. Feed it every
 * keydown; on Enter it says what was typed just before and whether it came
 * as a burst: at least two characters, each within 60 ms of the last, and
 * the Enter within 300 ms. Whether a burst is a product is for the caller to
 * check (a fast hand can type a burst too).
 */
export class BurstWatcher {
  private chars: string[] = [];
  private last = Number.NEGATIVE_INFINITY;

  /** A key went down at `time` (the event's timeStamp). On Enter: what came before it, and whether it was a burst. */
  key(key: string, time: number): { code: string; burst: boolean } | null {
    if (PASS_THROUGH.has(key)) return null;
    const gap = time - this.last;
    this.last = time;
    if (key === 'Enter') {
      const typed = this.chars;
      this.chars = [];
      if (typed.length === 0) return null;
      return { code: typed.join(''), burst: typed.length >= 2 && gap < SCAN_SUFFIX_MS };
    }
    if (key.length !== 1) {
      this.chars = [];
      return null;
    }
    this.chars = gap < SCANNER_GAP_MS ? [...this.chars, key] : [key];
    return null;
  }

  /** How many characters of a burst have arrived so far (1 for a single hand-typed key). */
  get length(): number {
    return this.chars.length;
  }
}

/** An Enter this soon after a scan's own Enter is the scanner's second one (CR+LF, or a double Enter), not a hand asking to pay. */
export const DOUBLE_ENTER_MS = 150;

/** A scanner's burst this long that names no product is a code 4VD doesn't know, never cash. */
export const UNKNOWN_SCAN_LENGTH = 4;

/**
 * What an Enter in Pay means, from what came just before it:
 * - product: the scanner read a product on this shelf; it goes back to the basket and the cash stays as it was;
 * - unknown: the scanner read a code that is no product; nothing is recorded until the cashier looks;
 * - pay: a hand typed the cash (or a short quick "20"): Record sale.
 */
export function payEnter(typed: { code: string; burst: boolean } | null, isProductCode: (code: string) => boolean): { kind: 'product' | 'unknown'; code: string } | { kind: 'pay' } {
  if (!typed?.burst) return { kind: 'pay' };
  const code = typed.code.trim();
  if (isProductCode(code)) return { kind: 'product', code };
  if (code.length >= UNKNOWN_SCAN_LENGTH) return { kind: 'unknown', code };
  return { kind: 'pay' };
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
  const lower = code.toLowerCase();
  return (
    shelf.find((product) => product.barcode === code || product.otherBarcodes.includes(code)) ??
    shelf.find((product) => product.sku !== null && product.sku.toLowerCase() === lower)
  );
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
 * - refused: the server read it and said no (4xx), so nothing was recorded (a key it knows gets its first answer back instead);
 * - offline: it never got there, or no answer came in time: it may or may not be in;
 * - unclear: the server broke while working on it (5xx): it may or may not be in.
 * Only a refusal frees the basket; the others keep the same sale and key for Send it again.
 */
export function payFailure(error: unknown): 'refused' | 'offline' | 'unclear' {
  if (isNetworkFailure(error)) return 'offline';
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return 'refused';
  return 'unclear';
}
