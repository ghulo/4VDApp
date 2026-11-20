/*
 * The till's own note of each sale it has settled (shown as paid, its basket
 * closed, its receipt sent to the printer), by the key made at Pay. It is
 * written before the basket closes, before a waiting sale leaves the queue
 * and before the receipt prints, so after a crash or a reload:
 * - a basket still showing that sale is closed without settling it again;
 * - Send it again never settles or prints a sale twice;
 * - a receipt that was printing when the till closed goes to Not printed, to
 *   be checked on the printer before it is printed again;
 * - what is still to do for the sale (put its fiscal receipt number on the
 *   invoice, put an unprinted receipt in Not printed) is done after a restart.
 * Each note keeps who sold it and in which business: its follow-ups run only
 * while they are signed in there. Kept per PC (baskets move with Switch person).
 */

import type { ReceiptInput } from './useFiscalPrinter';

const STORAGE_KEY = '4vd.counter.settled';
/** Enough for days of sales; older notes go first (never one with something still to do). */
export const MAX_SETTLED = 300;
/** A note older than this can't matter any more (a basket waits hours, not days), unless it still has something to do. */
const KEEP_MS = 7 * 24 * 3600_000;

export interface SettledSale {
  key: string;
  /** Who sold it and where: its follow-ups wait for them. */
  businessId: number;
  userId: number;
  /** 0 while a sale made offline waits to be sent. */
  documentId: number;
  number: string;
  total: number;
  /** When the sale was made (ISO). */
  at: string;
  /** When the till settled it (ms). */
  settledAt: number;
  /**
   * printing: sent to the printer, no answer yet (a crash then leaves it so);
   * check: whether it came out is unknown, so the printer must be looked at.
   */
  print: 'none' | 'printing' | 'printed' | 'failed' | 'check';
  /** The receipt, kept while it prints or waits for Not printed. */
  text?: string;
  job?: ReceiptInput;
  /** Still to do: this fiscal receipt number goes on the invoice; this reason puts the receipt in Not printed. */
  followUp?: { fiscalNo?: string; unprinted?: string };
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

const hasFollowUp = (sale: SettledSale) => sale.followUp?.fiscalNo !== undefined || sale.followUp?.unprinted !== undefined;

/** The note for this key, if the till settled that sale. */
export const settledSale = (store: SettledStore, key: string): SettledSale | undefined => store.read().find((sale) => sale.key === key);

/** Note a settled sale (or change its note); old notes beyond the cap go, never one with something still to do. False when it couldn't be written. */
export function noteSettled(store: SettledStore, sale: SettledSale, now = Date.now()): boolean {
  const others = store.read().filter((one) => one.key !== sale.key && (hasFollowUp(one) || now - one.settledAt < KEEP_MS));
  const all = [...others, sale];
  let over = all.length - MAX_SETTLED;
  const kept = all.filter((one) => {
    if (over <= 0 || hasFollowUp(one) || one === sale) return true;
    over -= 1;
    return false;
  });
  return store.write(kept);
}

/**
 * How the receipt came out. Printed with a number: that number is still to go
 * on the invoice. Failed: the receipt is still to go to Not printed (with why).
 * The receipt itself is kept only while that waits. False when it couldn't be written.
 */
export function notePrinted(store: SettledStore, key: string, outcome: { ok: true; fiscalNo: string | null } | { ok: false; reason: string }): boolean {
  const sale = settledSale(store, key);
  if (!sale) return false;
  if (outcome.ok) {
    const { text: _text, job: _job, ...rest } = sale;
    return noteSettled(store, { ...rest, print: 'printed', ...(outcome.fiscalNo && { followUp: { ...sale.followUp, fiscalNo: outcome.fiscalNo } }) });
  }
  return noteSettled(store, { ...sale, print: 'failed', followUp: { ...sale.followUp, unprinted: outcome.reason } });
}

/**
 * Receipts that were printing when the till closed (or whose answer never got
 * noted): whether they came out is unknown, so each is marked "check the
 * printer" and is still to go to Not printed. Only those settled before
 * `settledBefore`, and never one this till is printing right now (`busy`).
 */
export function markInterrupted(store: SettledStore, settledBefore: number, reason: string, busy: (key: string) => boolean = () => false): void {
  const all = store.read();
  const cutOff = (sale: SettledSale) => sale.print === 'printing' && sale.settledAt < settledBefore && !busy(sale.key);
  if (!all.some(cutOff)) return;
  store.write(all.map((sale) => (cutOff(sale) ? { ...sale, print: 'check' as const, followUp: { ...sale.followUp, unprinted: reason } } : sale)));
}

/** Notes with something still to do, for this person in this business only. */
export const followUpsFor = (store: SettledStore, owner: { businessId: number; userId: number }): SettledSale[] =>
  store.read().filter((sale) => hasFollowUp(sale) && sale.documentId > 0 && sale.businessId === owner.businessId && sale.userId === owner.userId);

/** One follow-up is done; the receipt goes once Not printed has it. False when it couldn't be written. */
export function followUpDone(store: SettledStore, key: string, done: 'fiscalNo' | 'unprinted'): boolean {
  const sale = settledSale(store, key);
  if (!sale?.followUp) return true;
  const { [done]: _gone, ...left } = sale.followUp;
  const { followUp: _old, ...rest } = sale;
  const next: SettledSale = { ...rest, ...(Object.keys(left).length > 0 && { followUp: left }) };
  if (done === 'unprinted') {
    delete next.text;
    delete next.job;
  }
  return noteSettled(store, next);
}
