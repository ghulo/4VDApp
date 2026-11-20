import { useCallback, useEffect, useRef, useState } from 'react';
import { type BasketSale, salesApi } from '../../services/api';
import { localStore, newSaleKey, type QueuedSale, sendWaiting, withTimeout } from './offlineQueue';
import { localSettledStore, noteSettled } from './settledSales';

type Sent = BasketSale;

/** How often waiting sales are tried again while the PC is connected. */
const RETRY_MS = 30_000;
/** How long one sale may take to send before the round stops (no internet behind the Wi-Fi). */
const SEND_TIMEOUT_MS = 15_000;

/** The till's note that this waiting sale is in 4VD now, written before it leaves the queue. */
function noteSent(sale: QueuedSale, result: Sent): void {
  noteSettled(localSettledStore, {
    key: sale.key,
    documentId: result.invoice.id,
    number: result.invoice.number,
    total: result.total,
    at: sale.at,
    settledAt: Date.now(),
    print: sale.receipt ? (sale.receipt.printed ? 'printed' : 'failed') : 'none',
  });
}

/**
 * The Counter's sales waiting for the internet: kept on this PC, sent oldest
 * first as soon as it is back (and every half minute while any wait). Only the
 * signed-in person's sales from the business they are in go, each sent as
 * theirs: who is at the till is asked again before every sale, and the server
 * refuses a sale that arrives once someone else is signed in.
 */
export function useWaitingSales(
  connected: boolean,
  userId: number,
  businessId: number,
  /** Whether the server answered the last round. */
  onReach: (ok: boolean) => void,
  onSent: (sent: Array<{ sale: QueuedSale; result: Sent }>) => void,
) {
  const [sales, setSales] = useState<QueuedSale[]>(() => localStore.read());
  // The round in progress: a second call (Switch person) waits for it instead of returning at once.
  const running = useRef<Promise<void> | null>(null);
  // Receipts still printing: their sale waits until the printer has answered.
  const printing = useRef(new Set<string>());
  const ownerRef = useRef({ userId, businessId });
  const sentRef = useRef(onSent);
  const reachRef = useRef(onReach);
  useEffect(() => {
    sentRef.current = onSent;
    reachRef.current = onReach;
    ownerRef.current = { userId, businessId };
  });
  const refresh = () => setSales(localStore.read());

  const flush = useCallback((): Promise<void> => {
    if (running.current) return running.current;
    const round = (async () => {
      try {
        const { sent, stoppedByNetwork } = await sendWaiting(
          localStore,
          (sale) =>
            withTimeout(
              (signal) => salesApi.recordBasket({ ...sale.body, clientKey: sale.key, soldAt: sale.at }, { expectOwner: { businessId: sale.businessId, userId: sale.userId }, signal }),
              SEND_TIMEOUT_MS,
            ),
          // Only whoever is at the till now, in the business they are in; the others wait for them.
          (sale) => sale.userId !== ownerRef.current.userId || sale.businessId !== ownerRef.current.businessId || printing.current.has(sale.key),
          noteSent,
        );
        if (sent.length > 0 || stoppedByNetwork) reachRef.current(!stoppedByNetwork);
        if (sent.length > 0) sentRef.current(sent);
      } finally {
        running.current = null;
        refresh();
      }
    })();
    running.current = round;
    return round;
  }, []);

  const mine = (sale: QueuedSale) => sale.userId === userId && (sale.businessId === undefined || sale.businessId === businessId);
  // Kept by an older 4VD without its business: it waits for the person who made it to say it was sold here.
  const unplaced = (sale: QueuedSale) => sale.businessId === undefined;
  const pending = sales.filter((sale) => !sale.refused && !unplaced(sale)).length;
  useEffect(() => {
    if (!connected) return;
    void flush();
    if (pending === 0) return;
    const timer = window.setInterval(() => void flush(), RETRY_MS);
    return () => window.clearInterval(timer);
  }, [connected, pending, flush]);

  return {
    waiting: sales.filter((sale) => !sale.refused && !unplaced(sale)),
    /** Refused by the server, or kept without a business: the signed-in person's own, for them to look at. */
    refused: sales.filter((sale) => mine(sale) && (sale.refused !== undefined || unplaced(sale))),
    /** Keep a sale made offline; its receipt prints next, so it waits for that. False when this PC couldn't keep it. */
    add(sale: QueuedSale): boolean {
      if (localStore.write([...localStore.read(), sale]) === false) return false;
      printing.current.add(sale.key);
      refresh();
      return true;
    },
    /** Whether a sale with this key waits on this PC already. */
    has: (key: string) => localStore.read().some((sale) => sale.key === key),
    /** The printer answered (or never got it): note how it went, and the sale may go. */
    printed(key: string, receipt: QueuedSale['receipt']) {
      localStore.write(localStore.read().map((sale) => (sale.key === key ? { ...sale, receipt } : sale)));
      printing.current.delete(key);
      refresh();
      if (navigator.onLine) void flush();
    },
    /**
     * Send the refused ones again (after the cause was fixed, like a month
     * reopened), the signed-in person's own. Each is first settled under its
     * key on the server: recorded after all, it counts as sent; otherwise its
     * key is closed for good, and it goes again under a new one. One kept
     * without its business goes in the business the person is in now.
     */
    async retry(): Promise<void> {
      const owner = { ...ownerRef.current };
      const settled: Array<{ sale: QueuedSale; result: Sent }> = [];
      for (const sale of localStore.read()) {
        if (sale.userId !== owner.userId || (sale.businessId !== undefined && sale.businessId !== owner.businessId)) continue;
        if (sale.refused === undefined && sale.businessId !== undefined) continue;
        let key = sale.key;
        if (sale.refused !== undefined) {
          let answer: Awaited<ReturnType<typeof salesApi.stopBasket>>;
          try {
            answer = await withTimeout((signal) => salesApi.stopBasket(sale.key, { expectOwner: owner, signal }), SEND_TIMEOUT_MS);
          } catch {
            // No answer: it stays as it is, for the next try.
            break;
          }
          if (answer.state === 'recorded') {
            noteSent(sale, answer.sale);
            settled.push({ sale, result: answer.sale });
            localStore.write(localStore.read().filter((one) => one.key !== sale.key));
            continue;
          }
          key = newSaleKey();
        }
        localStore.write(localStore.read().map((one) => (one.key === sale.key ? { ...one, key, refused: undefined, businessId: owner.businessId } : one)));
      }
      refresh();
      if (settled.length > 0) sentRef.current(settled);
      await flush();
    },
    flush,
  };
}
