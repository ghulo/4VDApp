import { useCallback, useEffect, useRef, useState } from 'react';
import { salesApi } from '../../services/api';
import { localStore, type QueuedSale, sendWaiting, withTimeout } from './offlineQueue';

type Sent = Awaited<ReturnType<typeof salesApi.recordBasket>>;

/** How often waiting sales are tried again while the PC is connected. */
const RETRY_MS = 30_000;
/** How long one sale may take to send before the round stops (no internet behind the Wi-Fi). */
const SEND_TIMEOUT_MS = 15_000;

/**
 * The Counter's sales waiting for the internet: kept on this PC, sent oldest
 * first as soon as it is back (and every half minute while any wait). Only the
 * signed-in person's sales go, so each is recorded as theirs.
 */
export function useWaitingSales(
  connected: boolean,
  userId: number,
  /** Whether the server answered the last round. */
  onReach: (ok: boolean) => void,
  onSent: (sent: Array<{ sale: QueuedSale; result: Sent }>) => void,
) {
  const [sales, setSales] = useState<QueuedSale[]>(() => localStore.read());
  const sending = useRef(false);
  // Receipts still printing: their sale waits until the printer has answered.
  const printing = useRef(new Set<string>());
  const sentRef = useRef(onSent);
  const reachRef = useRef(onReach);
  useEffect(() => {
    sentRef.current = onSent;
    reachRef.current = onReach;
  });
  const refresh = () => setSales(localStore.read());

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      const { sent, stoppedByNetwork } = await sendWaiting(
        localStore,
        (sale) => withTimeout(salesApi.recordBasket({ ...sale.body, clientKey: sale.key, soldAt: sale.at }), SEND_TIMEOUT_MS),
        (sale) => sale.userId !== userId || printing.current.has(sale.key),
      );
      if (sent.length > 0 || stoppedByNetwork) reachRef.current(!stoppedByNetwork);
      if (sent.length > 0) sentRef.current(sent);
    } finally {
      sending.current = false;
      refresh();
    }
  }, [userId]);

  const pending = sales.filter((sale) => !sale.refused).length;
  useEffect(() => {
    if (!connected) return;
    void flush();
    if (pending === 0) return;
    const timer = window.setInterval(() => void flush(), RETRY_MS);
    return () => window.clearInterval(timer);
  }, [connected, pending, flush]);

  return {
    waiting: sales.filter((sale) => !sale.refused),
    refused: sales.filter((sale) => sale.refused),
    /** Keep a sale made offline; its receipt prints next, so it waits for that. */
    add(sale: QueuedSale) {
      printing.current.add(sale.key);
      localStore.write([...localStore.read(), sale]);
      refresh();
    },
    /** The printer answered: note how it went, and the sale may go. */
    printed(key: string, receipt: QueuedSale['receipt']) {
      localStore.write(localStore.read().map((sale) => (sale.key === key ? { ...sale, receipt } : sale)));
      printing.current.delete(key);
      refresh();
      if (navigator.onLine) void flush();
    },
    /** Send the refused ones again (after the cause was fixed, like a month reopened). */
    retry() {
      localStore.write(localStore.read().map(({ refused: _refused, ...sale }) => sale));
      refresh();
      void flush();
    },
    flush,
  };
}
