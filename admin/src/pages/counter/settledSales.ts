/*
 * The till's own note of each sale it has settled (shown as paid, its basket
 * closed, its receipt sent to the printer), by the key made at Pay. It is
 * written before the basket closes, before a waiting sale leaves the queue
 * and before the receipt prints, so after a crash or a reload:
 * - a basket still showing that sale is closed without settling it again;
 * - Send it again never settles or prints a sale twice;
 * - a receipt that was printing when the till closed goes to Not printed, to
 *   be checked on the printer before it is printed again.
 * Kept per PC (not per person: baskets move with Switch person), for a few days.
 */

import type { ReceiptInput } from './useFiscalPrinter';

const STORAGE_KEY = '4vd.counter.settled';
/** Enough for days of sales; older notes go first. */
export const MAX_SETTLED = 300;
/** A note older than this can't matter any more (a basket waits hours, not days). */
const KEEP_MS = 7 * 24 * 3600_000;

export interface SettledSale {
  key: string;
  /** 0 while a sale made offline waits to be sent. */
  documentId: number;
  number: string;
  total: number;
  /** When the sale was made (ISO). */
  at: string;
  /** When the till settled it (ms). */
  settledAt: number;
  /** printing: sent to the printer, no answer yet (a crash then leaves it so). */
  print: 'none' | 'printing' | 'printed' | 'failed';
  /** The receipt, kept only while it prints. */
  text?: string;
  job?: ReceiptInput;
}

export interface SettledStore {
  read(): SettledSale[];
  /** False when this PC's storage refused it. */
  write(sales: SettledSale[]): boolean;
}

export const localSettledStore: SettledStore = {
  read() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
      return Array.isArray(saved) ? (saved as SettledSale[]) : [];
    } catch {
      return [];
    }
  },
  write(sales) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sales));
      return true;
    } catch {
      return false;
    }
  },
};

/** The note for this key, if the till settled that sale. */
export const settledSale = (store: SettledStore, key: string): SettledSale | undefined => store.read().find((sale) => sale.key === key);

/** Note a settled sale (or change its note); old notes beyond the cap go. False when it couldn't be written. */
export function noteSettled(store: SettledStore, sale: SettledSale, now = Date.now()): boolean {
  const others = store.read().filter((one) => one.key !== sale.key && now - one.settledAt < KEEP_MS);
  return store.write([...others, sale].slice(-MAX_SETTLED));
}

/** How the receipt came out; the receipt itself is no longer kept. */
export function notePrinted(store: SettledStore, key: string, print: 'printed' | 'failed', documentId?: number, number?: string): void {
  const sale = settledSale(store, key);
  if (!sale) return;
  const { text: _text, job: _job, ...rest } = sale;
  noteSettled(store, { ...rest, print, ...(documentId !== undefined && { documentId }), ...(number !== undefined && { number }) });
}

/**
 * Receipts that were printing when the till closed: whether they came out is
 * unknown, so each is handed back (once) to go to Not printed, marked failed.
 * Only those settled before `settledBefore`: one printing right now is left alone.
 */
export function takeInterrupted(store: SettledStore, settledBefore = Number.POSITIVE_INFINITY): SettledSale[] {
  const all = store.read();
  const cutOff = (sale: SettledSale) => sale.print === 'printing' && sale.settledAt < settledBefore;
  const interrupted = all.filter(cutOff);
  if (interrupted.length > 0) store.write(all.map((sale) => (cutOff(sale) ? { ...sale, print: 'failed' as const } : sale)));
  return interrupted;
}
