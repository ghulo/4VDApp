import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { Catalogue } from '../../i18n/en';
import { displayJob, type ReceiptLine, type ReceiptPayment } from '../../utils/fiscalReceipt';

/** What a receipt is built from, kept so it can be built again (a printer tax group set later, an empty text kept by an older version). */
export interface ReceiptInput {
  lines: ReceiptLine[];
  payment: ReceiptPayment;
}

/** Whether this screen can print: only from the Windows app, with F-Link running beside it. */
export type PrinterReach = 'checking' | 'off' | 'browser' | 'oldApp' | 'noFolder' | 'notRunning' | 'ready';

export type PrintResult = { ok: true; receiptNo: string | null } | { ok: false; message: string };

/**
 * How a sale's last receipt came out, by the Windows app's own journal (kept on
 * its disk, so it survives a reload of the page): printed or failed (with the
 * answer), still printing (the app has it now), unknown (the app closed while
 * it printed, or never noted it), or none (this app printed nothing for it).
 * Null when this screen can't ask (a browser, an older app).
 */
export type PrintOutcome = { kind: 'done'; result: PrintResult } | { kind: 'printing' } | { kind: 'unknown' } | { kind: 'none' };

type JournalEntry = Awaited<ReturnType<NonNullable<NonNullable<Window['fourvdDesktop']>['fiscalLookup']>>>;

/** The journal's entry, as an outcome the Counter acts on. */
export function journalOutcome(entry: JournalEntry, t: Catalogue['counter']): PrintOutcome {
  if (!entry) return { kind: 'none' };
  if (entry.status === 'printing') return { kind: 'printing' };
  if (entry.status === 'printed') return { kind: 'done', result: { ok: true, receiptNo: entry.receiptNo } };
  if (entry.status === 'failed') return { kind: 'done', result: { ok: false, message: plainReason(entry.message, t) } };
  if (entry.status === 'not_running') return { kind: 'done', result: { ok: false, message: `${t.printer.notRunning}. ${t.printer.notRunningHint}` } };
  if (entry.status === 'no_folder') return { kind: 'done', result: { ok: false, message: t.printer.noFolder('C:\\TEMP') } };
  return { kind: 'unknown' };
}

/** A sale that is recorded but whose receipt didn't print, kept until it does. */
export interface Unprinted {
  documentId: number;
  number: string;
  total: number;
  at: string;
  /** The printer's job; empty when it couldn't be built (then `job` builds it again). */
  text: string;
  reason: string;
  job?: ReceiptInput;
  /** The business it was sold in: it shows only there (left out by an older 4VD). */
  businessId?: number;
  /** The key its last print went to the Windows app with: the app's journal says how that print came out. */
  printKey?: string;
}

const STORE = '4vd.counter.unprinted';

function writeUnprinted(items: Unprinted[]): boolean {
  try {
    localStorage.setItem(STORE, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

function readUnprinted(): Unprinted[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '[]') as Unprinted[];
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

/** Receipts on this PC still waiting to be printed. */
export const unprintedWaiting = (): boolean => readUnprinted().length > 0;

/** F-Link's messages, in words the person at the counter can act on. */
export function plainReason(message: string | null, t: Catalogue['counter']): string {
  if (!message) return t.printer.unknown;
  if (/paper/i.test(message) || /#13\b/.test(message)) return t.reasonsPlain.paper;
  if (/mechanical/i.test(message) || /#6\b/.test(message)) return t.reasonsPlain.mechanical;
  if (/fiscal mode|not allowed/i.test(message) || /#11\b/.test(message)) return t.reasonsPlain.mode;
  if (/com ?port|device not found|not found/i.test(message)) return t.reasonsPlain.port;
  if (/different prices/i.test(message)) return t.reasonsPlain.twoPrices;
  return message;
}

/**
 * The fiscal printer beside this PC, through the Windows app: whether it can
 * print, one job at a time, and the receipts still waiting to be printed.
 */
export function useFiscalPrinter(enabled: boolean, t: Catalogue['counter']) {
  const bridge = typeof window === 'undefined' ? undefined : window.fourvdDesktop;
  const status = useQuery({
    queryKey: ['fiscal-status'],
    queryFn: () => bridge!.fiscalStatus!(),
    enabled: enabled && Boolean(bridge?.fiscalStatus),
    refetchInterval: 30_000,
  });

  let reach: PrinterReach;
  if (!enabled) reach = 'off';
  else if (!bridge) reach = 'browser';
  else if (!bridge.fiscalStatus || !bridge.fiscalSend) reach = 'oldApp';
  else if (!status.data) reach = 'checking';
  else if (!status.data.folder) reach = 'noFolder';
  else if (!status.data.flink) reach = 'notRunning';
  else reach = 'ready';

  const [busy, setBusy] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [unprinted, setUnprinted] = useState<Unprinted[]>(readUnprinted);
  // Written to this PC at once (not after the next render), so a receipt handed over to the list is never lost in between.
  const list = useRef(unprinted);
  const change = useCallback((next: Unprinted[]): boolean => {
    list.current = next;
    setUnprinted(next);
    // If it can't be written, the list still works until the page closes.
    return writeUnprinted(next);
  }, []);

  /** Hand one job to F-Link; jobs wait for each other, so two receipts never mix. */
  const send = useCallback(
    (name: string, text: string, key?: string): Promise<PrintResult> => {
      const run = async (): Promise<PrintResult> => {
        if (!bridge?.fiscalSend) return { ok: false, message: t.printer.browser };
        setBusy(true);
        try {
          const answer = await bridge.fiscalSend({ name, text, ...(key && { key }) });
          if (answer.status === 'printed') return { ok: true, receiptNo: answer.receiptNo };
          if (answer.status === 'failed') return { ok: false, message: plainReason(answer.message, t) };
          if (answer.status === 'not_running') return { ok: false, message: `${t.printer.notRunning}. ${t.printer.notRunningHint}` };
          return { ok: false, message: t.printer.noFolder(status.data?.path ?? 'C:\\TEMP') };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : t.printer.unknown };
        } finally {
          setBusy(false);
          void status.refetch();
        }
      };
      const next = queue.current.then(run, run);
      queue.current = next;
      return next;
    },
    [bridge, status, t],
  );

  /*
   * The customer display: only the newest two lines matter. A scan while the
   * last one is still on its way replaces what waits, so a fast scanner never
   * builds a queue in front of the next receipt. Failures stay quiet.
   */
  const waiting = useRef<string | null>(null);
  const show = useCallback(
    (lines: [string, string]) => {
      if (!enabled || !bridge?.fiscalSend) return;
      const first = waiting.current === null;
      waiting.current = displayJob(lines[0], lines[1]);
      if (!first) return;
      const run = async () => {
        const text = waiting.current;
        waiting.current = null;
        if (text) await bridge.fiscalSend!({ name: '4VD-D', text }).catch(() => undefined);
      };
      queue.current = queue.current.then(run, run);
    },
    [bridge, enabled],
  );

  /** False when this PC couldn't write it down (it shows until the page closes). */
  const keepUnprinted = useCallback((item: Unprinted): boolean => change([item, ...list.current.filter((other) => other.documentId !== item.documentId)]), [change]);
  const forget = useCallback((documentId: number) => void change(list.current.filter((item) => item.documentId !== documentId)), [change]);

  /** How that sale's last receipt came out, by the Windows app's journal; null when this screen can't ask. A failed question counts as unknown. */
  const lookup = useCallback(
    async (key: string): Promise<PrintOutcome | null> => {
      if (!bridge?.fiscalLookup) return null;
      try {
        return journalOutcome(await bridge.fiscalLookup(key), t);
      } catch {
        return { kind: 'unknown' };
      }
    },
    [bridge, t],
  );

  return { reach, path: status.data?.path ?? 'C:\\TEMP', busy, send, lookup, show, unprinted, keepUnprinted, forget, recheck: () => status.refetch() };
}
