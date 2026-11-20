/*
 * Sales made at the Counter while the internet is down. Each waits here, in
 * this PC's storage (the Windows app keeps it on disk, so a restart loses
 * nothing), until it can be sent. The key given when Pay was pressed travels
 * with it, so a sale sent twice is recorded once.
 */

import { ApiError } from '../../services/apiClient';
import type { ReceiptInput } from './useFiscalPrinter';

const STORAGE_KEY = '4vd.counter.offline';

export interface QueuedSale {
  /** Given when Pay was pressed; the server records a sale once per key. */
  key: string;
  /** When the sale was made (ISO). */
  at: string;
  /** Who sold it, and in which business: it is sent only while they are signed in there. */
  userId: number;
  /** Left out by an older 4VD: such a sale waits until the person who made it says it belongs to the business they are in. */
  businessId?: number;
  /** The basket as the server takes it (POST /sales/basket). */
  body: {
    items: Array<{ productId: number; quantity: number; discountPercent?: number; offerPrice?: number; shortDatedId?: number }>;
    notes: null;
    paidBy?: 'card';
    cardAmount?: number;
    customerId?: number;
    paidNow?: boolean;
    rabatApproval?: string;
    /** Wholesale prices on or off, as the Counter showed them. */
    wholesale?: boolean;
  };
  total: number;
  /**
   * The fiscal receipt, printed at once: its text, and whether it printed (with
   * the printer's number). One that didn't goes to Not printed once the sale is sent.
   * Written before it goes to the printer, marked `interrupted`: a till closed
   * mid-print leaves that mark, and the receipt goes to Not printed to be checked.
   */
  receipt: { text: string; printed: boolean; fiscalNo: string | null; reason: string; job?: ReceiptInput; interrupted?: boolean } | null;
  /** The server refused it (not a network problem): why, for the owner to see. */
  refused?: string;
}

export interface QueueStore {
  read(): QueuedSale[];
  /** False when this PC's storage refused it. */
  write(sales: QueuedSale[]): boolean | void;
}

/** The browser's storage, which the Windows app keeps on the PC's disk. */
export const localStore: QueueStore = {
  read() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
      return Array.isArray(saved) ? (saved as QueuedSale[]) : [];
    } catch {
      return [];
    }
  },
  write(sales) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sales));
      return true;
    } catch {
      // Full or blocked storage: the caller is told, so a sale is never shown as kept when it isn't.
      return false;
    }
  },
};

/**
 * The server's answer, or a network failure once `ms` pass without one (a
 * hanging connection counts as no internet). The request is stopped then, so
 * no copy of it goes out later; it may still have reached the server, so a
 * timeout is never taken as a no.
 */
export function withTimeout<T>(start: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError('The server did not answer in time', 0, 'NETWORK'));
    }, ms);
    start(controller.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** A new key for a sale, made when Pay is pressed. */
export const newSaleKey = (): string => crypto.randomUUID();

/** True when an error means the server was never reached (no internet, server down), so the sale should wait. */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504;
  return error instanceof TypeError;
}

/**
 * What a failed send of a waiting sale means:
 * - network: no internet, the round stops;
 * - wait: no answer about the sale itself (another person or business signed in
 *   now, signed out, too many requests, a fault on the server): it stays as it
 *   is, the round stops, and it goes again later with the same key;
 * - refused: the server read it and said no. It stays, marked, for someone to look at.
 */
export function queueFailure(error: unknown): 'network' | 'wait' | 'refused' {
  if (isNetworkFailure(error)) return 'network';
  if (!(error instanceof ApiError)) return 'wait';
  if (error.code === 'OWNER_CHANGED' || error.status === 401 || error.status === 408 || error.status === 429 || error.status >= 500) return 'wait';
  return error.status >= 400 ? 'refused' : 'wait';
}

/**
 * Send the waiting sales, oldest first. A sale the server refuses stays,
 * marked with why; a network failure, or any answer that says nothing about
 * the sale, stops the round (the rest wait). A sale without its business
 * (kept by an older 4VD) never goes by itself. `skip` is asked before each
 * one, so a person switched meanwhile stops the round's other sales.
 * `onEach` keeps each sale the server took (its settled note) before it
 * leaves the queue; if that can't be written, the sale stays and the round stops.
 */
export async function sendWaiting<T>(
  store: QueueStore,
  send: (sale: QueuedSale & { businessId: number }) => Promise<T>,
  /** Sales to leave for now (a receipt still printing, another person's sale). */
  skip: (sale: QueuedSale) => boolean = () => false,
  onEach: (sale: QueuedSale, result: T) => boolean = () => true,
): Promise<{ sent: Array<{ sale: QueuedSale; result: T }>; stoppedByNetwork: boolean; unsaved?: boolean }> {
  const sent: Array<{ sale: QueuedSale; result: T }> = [];
  for (const sale of [...store.read()].sort((a, b) => a.at.localeCompare(b.at))) {
    if (sale.refused || sale.businessId === undefined || skip(sale)) continue;
    try {
      const result = await send({ ...sale, businessId: sale.businessId });
      // Its note couldn't be written: it stays in the queue (sent again later, 4VD gives the same sale back).
      if (!onEach(sale, result)) return { sent, stoppedByNetwork: false, unsaved: true };
      sent.push({ sale, result });
      store.write(store.read().filter((one) => one.key !== sale.key));
    } catch (error) {
      const failure = queueFailure(error);
      if (failure === 'network') return { sent, stoppedByNetwork: true };
      if (failure === 'wait') return { sent, stoppedByNetwork: false };
      const why = error instanceof Error ? error.message : String(error);
      store.write(store.read().map((one) => (one.key === sale.key ? { ...one, refused: why } : one)));
    }
  }
  return { sent, stoppedByNetwork: false };
}
