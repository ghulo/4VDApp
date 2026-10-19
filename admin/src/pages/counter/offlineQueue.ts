/*
 * Sales made at the Counter while the internet is down. Each waits here, in
 * this PC's storage (the Windows app keeps it on disk, so a restart loses
 * nothing), until it can be sent. The key given when Pay was pressed travels
 * with it, so a sale sent twice is recorded once.
 */

import { ApiError } from '../../services/apiClient';

const STORAGE_KEY = '4vd.counter.offline';

export interface QueuedSale {
  /** Given when Pay was pressed; the server records a sale once per key. */
  key: string;
  /** When the sale was made (ISO). */
  at: string;
  /** Who sold it. */
  userId: number;
  /** The basket as the server takes it (POST /sales/basket). */
  body: {
    items: Array<{ productId: number; quantity: number; discountPercent?: number }>;
    notes: null;
    paidBy?: 'card';
    cardAmount?: number;
    customerId?: number;
    paidNow?: boolean;
    rabatApproval?: string;
  };
  total: number;
  /**
   * The fiscal receipt, printed at once: its text, and whether it printed (with
   * the printer's number). One that didn't goes to Not printed once the sale is sent.
   */
  receipt: { text: string; printed: boolean; fiscalNo: string | null; reason: string } | null;
  /** The server refused it (not a network problem): why, for the owner to see. */
  refused?: string;
}

export interface QueueStore {
  read(): QueuedSale[];
  write(sales: QueuedSale[]): void;
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
    } catch {
      // Full or blocked storage: the sale still waits in memory until the page closes.
    }
  },
};

/** The server's answer, or a network failure once `ms` pass without one (a hanging connection counts as no internet). */
export function withTimeout<T>(request: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiError('The server did not answer in time', 0, 'NETWORK')), ms);
    request.then(
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
 * Send the waiting sales, oldest first. A sale the server refuses stays,
 * marked with why; a network failure stops the round (the rest wait).
 * Returns what was sent, with the server's answer.
 */
export async function sendWaiting<T>(
  store: QueueStore,
  send: (sale: QueuedSale) => Promise<T>,
  /** Sales to leave for now (a receipt still printing, another person's sale). */
  skip: (sale: QueuedSale) => boolean = () => false,
): Promise<{ sent: Array<{ sale: QueuedSale; result: T }>; stoppedByNetwork: boolean }> {
  const sent: Array<{ sale: QueuedSale; result: T }> = [];
  for (const sale of [...store.read()].sort((a, b) => a.at.localeCompare(b.at))) {
    if (sale.refused || skip(sale)) continue;
    try {
      const result = await send(sale);
      sent.push({ sale, result });
      store.write(store.read().filter((one) => one.key !== sale.key));
    } catch (error) {
      if (isNetworkFailure(error)) return { sent, stoppedByNetwork: true };
      const why = error instanceof Error ? error.message : String(error);
      store.write(store.read().map((one) => (one.key === sale.key ? { ...one, refused: why } : one)));
    }
  }
  return { sent, stoppedByNetwork: false };
}
