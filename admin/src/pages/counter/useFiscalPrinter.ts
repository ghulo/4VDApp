import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Catalogue } from '../../i18n/en';
import { displayJob } from '../../utils/fiscalReceipt';

/** Whether this screen can print: only from the Windows app, with F-Link running beside it. */
export type PrinterReach = 'checking' | 'off' | 'browser' | 'oldApp' | 'noFolder' | 'notRunning' | 'ready';

export type PrintResult = { ok: true; receiptNo: string | null } | { ok: false; message: string };

/** A sale that is recorded but whose receipt didn't print, kept until it does. */
export interface Unprinted {
  documentId: number;
  number: string;
  total: number;
  at: string;
  text: string;
  reason: string;
}

const STORE = '4vd.counter.unprinted';

function readUnprinted(): Unprinted[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '[]') as Unprinted[];
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

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

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(unprinted));
    } catch {
      // The list still works until the page closes.
    }
  }, [unprinted]);

  /** Hand one job to F-Link; jobs wait for each other, so two receipts never mix. */
  const send = useCallback(
    (name: string, text: string): Promise<PrintResult> => {
      const run = async (): Promise<PrintResult> => {
        if (!bridge?.fiscalSend) return { ok: false, message: t.printer.browser };
        setBusy(true);
        try {
          const answer = await bridge.fiscalSend({ name, text });
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

  const keepUnprinted = useCallback((item: Unprinted) => {
    setUnprinted((now) => [item, ...now.filter((other) => other.documentId !== item.documentId)]);
  }, []);
  const forget = useCallback((documentId: number) => setUnprinted((now) => now.filter((item) => item.documentId !== documentId)), []);

  return { reach, path: status.data?.path ?? 'C:\\TEMP', busy, send, show, unprinted, keepUnprinted, forget, recheck: () => status.refetch() };
}
