import { useCallback, useEffect, useRef, useState } from 'react';
import { type BasketSale, salesApi } from '../../services/api';
import { ApiError } from '../../services/apiClient';
import { localStore, newSaleKey, type QueuedSale, sendWaiting, settleInterrupted, withTimeout } from './offlineQueue';
import { localSettledStore, noteSettled, type SettledStore } from './settledSales';
import type { PrintOutcome } from './useFiscalPrinter';

type Sent = BasketSale;

/** How often waiting sales are tried again while the PC is connected. */
const RETRY_MS = 30_000;
/** How long one sale may take to send before the round stops (no internet behind the Wi-Fi). */
const SEND_TIMEOUT_MS = 15_000;

/**
 * The till's note that this waiting sale is in 4VD now, written before it
 * leaves the queue: who sold it and where, and what is still to do for its
 * receipt (its fiscal number onto the invoice, or Not printed). A receipt
 * still marked as printing (the till closed mid-print) stays so: like any
 * other, it is marked "check the printer" once the Windows app is surely done
 * with it. False when this PC couldn't write it: the sale then stays in the queue.
 */
export function noteSent(sale: QueuedSale & { businessId: number }, result: Sent, store: SettledStore = localSettledStore): boolean {
  const receipt = sale.receipt;
  const print = !receipt ? 'none' : receipt.printed ? 'printed' : receipt.interrupted ? 'printing' : 'failed';
  const fiscalNo = receipt?.printed && receipt.fiscalNo ? receipt.fiscalNo : undefined;
  const unprinted = receipt && !receipt.printed && !receipt.interrupted ? receipt.reason : undefined;
  return noteSettled(store, {
    key: sale.key,
    businessId: sale.businessId,
    userId: sale.userId,
    documentId: result.invoice.id,
    number: result.invoice.number,
    total: result.total,
    at: sale.at,
    settledAt: Date.now(),
    print,
    ...(receipt && !receipt.printed && { text: receipt.text, ...(receipt.job && { job: receipt.job }) }),
    ...((fiscalNo !== undefined || unprinted !== undefined) && {
      followUp: { ...(fiscalNo !== undefined && { fiscalNo }), ...(unprinted !== undefined && { unprinted }) },
    }),
  });
}

/**
 * The Counter's sales waiting for the internet: kept on this PC, sent oldest
 * first as soon as it is back (and every half minute while any wait). Only the
 * signed-in person's sales from the business they are in go, each sent as
 * theirs: who is at the till is asked again before every sale, and the server
 * refuses a sale that arrives once someone else is signed in. A sale kept by
 * an older 4VD without its business is never sent: an owner sees it, types it
 * in by hand if it is missing, and removes it.
 */
export function useWaitingSales(
  connected: boolean,
  userId: number,
  businessId: number,
  /** Whether the server answered the last round. */
  onReach: (ok: boolean) => void,
  onSent: (sent: Array<{ sale: QueuedSale; result: Sent }>) => void,
  /** A sale went in but this PC couldn't note it, so it stays in the queue. */
  onUnsaved: () => void,
  /** An owner: sees and settles everyone's refused sales in this business, not only their own. */
  oversees = false,
  /** How a sale's receipt came out, by the Windows app's journal (null: this screen can't ask). */
  lookupPrint?: (key: string) => Promise<PrintOutcome | null>,
) {
  const [sales, setSales] = useState<QueuedSale[]>(() => localStore.read());
  // The round in progress: a second call (Switch person) waits for it instead of returning at once.
  const running = useRef<Promise<void> | null>(null);
  // Receipts still printing: their sale waits until the printer has answered.
  const printing = useRef(new Set<string>());
  const ownerRef = useRef({ userId, businessId });
  const overseesRef = useRef(oversees);
  const lookupRef = useRef(lookupPrint);
  const sentRef = useRef(onSent);
  const reachRef = useRef(onReach);
  const unsavedRef = useRef(onUnsaved);
  useEffect(() => {
    sentRef.current = onSent;
    reachRef.current = onReach;
    unsavedRef.current = onUnsaved;
    ownerRef.current = { userId, businessId };
    overseesRef.current = oversees;
    lookupRef.current = lookupPrint;
  });
  const refresh = () => setSales(localStore.read());

  const flush = useCallback((): Promise<void> => {
    if (running.current) return running.current;
    const round = (async () => {
      try {
        // A receipt still marked as printing (the page closed or reloaded mid-print): the Windows app's journal says how it came out.
        // Still printing there, or its outcome couldn't be noted here: the sale waits, so nothing is released on a guess.
        const { holding, notNoted } = await settleInterrupted(localStore, lookupRef.current, (key) => printing.current.has(key));
        if (notNoted) unsavedRef.current();
        const { sent, stoppedByNetwork, unsaved } = await sendWaiting(
          localStore,
          (sale) =>
            withTimeout(
              (signal) => salesApi.recordBasket({ ...sale.body, clientKey: sale.key, soldAt: sale.at }, { expectOwner: { businessId: sale.businessId, userId: sale.userId }, signal }),
              SEND_TIMEOUT_MS,
            ),
          // Only whoever is at the till now, in the business they are in; the others wait for them.
          (sale) => sale.userId !== ownerRef.current.userId || sale.businessId !== ownerRef.current.businessId || printing.current.has(sale.key) || holding.has(sale.key),
          (sale, result) => noteSent({ ...sale, businessId: sale.businessId! }, result),
        );
        if (sent.length > 0 || stoppedByNetwork) reachRef.current(!stoppedByNetwork);
        if (sent.length > 0) sentRef.current(sent);
        if (unsaved) unsavedRef.current();
      } finally {
        running.current = null;
        refresh();
      }
    })();
    running.current = round;
    return round;
  }, []);

  // Refused sales the person at the till may look at: their own here, or (an owner) anyone's here.
  const mine = (sale: QueuedSale) => sale.businessId === businessId && (oversees || sale.userId === userId);
  // Kept by an older 4VD without its business: never sent (it might belong to another business), only shown to an owner.
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
    /** Refused by the server, in the business the till is in: the signed-in person's own (an owner: everyone's), to look at. */
    refused: sales.filter((sale) => mine(sale) && sale.refused !== undefined),
    /** Kept by an older 4VD without its business: whoever made them, for an owner to check against Sales. */
    unplaced: sales.filter(unplaced),
    /** An owner checked it against Sales (typing it in by hand if it was missing): it leaves this PC. */
    discard(key: string) {
      localStore.write(localStore.read().filter((sale) => !(sale.key === key && unplaced(sale))));
      refresh();
    },
    /** Keep a sale made offline; its receipt prints next, so it waits for that. False when this PC couldn't keep it. */
    add(sale: QueuedSale): boolean {
      if (localStore.write([...localStore.read(), sale]) === false) return false;
      printing.current.add(sale.key);
      refresh();
      return true;
    },
    /** Whether a sale with this key waits on this PC already. */
    has: (key: string) => localStore.read().some((sale) => sale.key === key),
    /** Whether this till is printing that sale's receipt right now. */
    isPrinting: (key: string) => printing.current.has(key),
    /**
     * The printer answered (or never got it): note how it went, and the sale may go.
     * If that can't be noted, the sale stays marked as printing, and the Windows app's journal settles it before it goes.
     */
    printed(key: string, receipt: QueuedSale['receipt']) {
      if (localStore.write(localStore.read().map((sale) => (sale.key === key ? { ...sale, receipt } : sale))) === false) unsavedRef.current();
      printing.current.delete(key);
      refresh();
      if (navigator.onLine) void flush();
    },
    /**
     * Send the refused ones again (after the cause was fixed, like a month
     * reopened), in the business the till is in: the signed-in person's own,
     * or (an owner) anyone's. Each is first settled under its key on the
     * server: recorded after all, it counts as sent; otherwise its key is
     * closed for good, and it waits again under a new one, still the sale of
     * whoever made it (it goes when they are at the till). 'needsOwner' when
     * 4VD lets only an owner settle one (its key was never closed, and
     * someone else's sale could have it).
     */
    async retry(): Promise<'needsOwner' | undefined> {
      const owner = { ...ownerRef.current };
      const settled: Array<{ sale: QueuedSale; result: Sent }> = [];
      let needsOwner = false;
      // A receipt still marked as printing is settled from the Windows app's journal first: a new key would lose its entry there.
      const { holding } = await settleInterrupted(localStore, lookupRef.current, (key) => printing.current.has(key));
      for (const sale of localStore.read()) {
        if (sale.refused === undefined || sale.businessId !== owner.businessId || (sale.userId !== owner.userId && !overseesRef.current)) continue;
        if (holding.has(sale.key)) continue;
        let answer: Awaited<ReturnType<typeof salesApi.stopBasket>>;
        try {
          answer = await withTimeout((signal) => salesApi.stopBasket(sale.key, { expectOwner: owner, signal }), SEND_TIMEOUT_MS);
        } catch (error) {
          if (error instanceof ApiError && error.status === 403) {
            needsOwner = true;
            continue;
          }
          // No answer: it stays as it is, for the next try.
          break;
        }
        if (answer.state === 'recorded') {
          // Its note first: if it can't be written, the sale stays as it is (a later try finds the same sale).
          if (!noteSent({ ...sale, businessId: owner.businessId }, answer.sale)) break;
          settled.push({ sale, result: answer.sale });
          localStore.write(localStore.read().filter((one) => one.key !== sale.key));
          continue;
        }
        const key = newSaleKey();
        localStore.write(localStore.read().map((one) => (one.key === sale.key ? { ...one, key, refused: undefined } : one)));
      }
      refresh();
      if (settled.length > 0) sentRef.current(settled);
      await flush();
      return needsOwner ? 'needsOwner' : undefined;
    },
    flush,
  };
}
