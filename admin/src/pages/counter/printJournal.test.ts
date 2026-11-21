import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { ApiError } from '../../services/apiClient';
import { fiscalFailure, type QueuedSale, type QueueStore, settleInterrupted } from './offlineQueue';
import { blockedIn, followUpDone, markCheck, noteBlocked, type SettledSale, type SettledStore, settledSale } from './settledSales';
import { journalOutcome, type PrintOutcome } from './useFiscalPrinter';

const job = { lines: [], payment: { by: 'card' as const } };
const waiting = (key: string, receipt: QueuedSale['receipt']): QueuedSale => ({
  key,
  at: '2026-11-20T10:00:00Z',
  userId: 2,
  businessId: 1,
  body: { items: [{ productId: 1, quantity: 1 }], notes: null },
  total: 2,
  receipt,
});
const cutOff = { text: 'job', printed: false, fiscalNo: null, reason: 'Check', job, interrupted: true };

function queue(sales: QueuedSale[], works = true): QueueStore & { sales: QueuedSale[] } {
  const store = {
    sales,
    read: () => store.sales,
    write: (next: QueuedSale[]) => {
      if (!works) return false;
      store.sales = next;
      return true;
    },
  };
  return store;
}

describe('the Windows app’s print journal, as the Counter reads it', () => {
  it('should turn each journal entry into what the till does', () => {
    const t = en.counter;
    expect(journalOutcome(null, t)).toEqual({ kind: 'none' });
    expect(journalOutcome({ status: 'printing', receiptNo: null, message: null }, t)).toEqual({ kind: 'printing' });
    expect(journalOutcome({ status: 'printed', receiptNo: '00042', message: null }, t)).toEqual({ kind: 'done', result: { ok: true, receiptNo: '00042' } });
    expect(journalOutcome({ status: 'failed', receiptNo: null, message: 'paper end' }, t)).toEqual({ kind: 'done', result: { ok: false, message: t.reasonsPlain.paper } });
    expect(journalOutcome({ status: 'unknown', receiptNo: null, message: null }, t)).toEqual({ kind: 'unknown' });
  });

  it('should settle a waiting sale’s cut-off receipt from the journal before it goes, and hold one the app still prints', async () => {
    const store = queue([waiting('printed', cutOff), waiting('failed', cutOff), waiting('busy', cutOff), waiting('unknown', cutOff), waiting('mine', cutOff), waiting('plain', null)]);
    const answers: Record<string, PrintOutcome> = {
      printed: { kind: 'done', result: { ok: true, receiptNo: '00042' } },
      failed: { kind: 'done', result: { ok: false, message: 'Paper out' } },
      busy: { kind: 'printing' },
      unknown: { kind: 'unknown' },
    };
    const asked: string[] = [];
    const acked: string[] = [];
    const { holding, notNoted } = await settleInterrupted(
      store,
      async (key) => {
        asked.push(key);
        return answers[key] ?? { kind: 'none' };
      },
      (key) => key === 'mine',
      (key) => acked.push(key),
    );
    expect(asked).toEqual(['printed', 'failed', 'busy', 'unknown']);
    // Only outcomes noted on the sale are acknowledged to the Windows app's journal.
    expect(acked).toEqual(['printed', 'failed']);
    expect([...holding]).toEqual(['busy']);
    expect(notNoted).toBe(false);
    const receipt = (key: string) => store.sales.find((one) => one.key === key)!.receipt;
    expect(receipt('printed')).toMatchObject({ printed: true, fiscalNo: '00042', interrupted: undefined });
    expect(receipt('failed')).toMatchObject({ printed: false, reason: 'Paper out', interrupted: undefined });
    expect(receipt('unknown')?.interrupted).toBe(true);
    expect(receipt('busy')?.interrupted).toBe(true);
  });

  it('should hold the sale when the journal’s answer can’t be noted on this PC', async () => {
    const store = queue([waiting('printed', cutOff)], false);
    const result = await settleInterrupted(store, async () => ({ kind: 'done', result: { ok: true, receiptNo: '1' } }), () => false);
    expect([...result.holding]).toEqual(['printed']);
    expect(result.notNoted).toBe(true);
  });

  it('should leave everything as it is where the screen can’t ask', async () => {
    const store = queue([waiting('a', cutOff)]);
    expect(await settleInterrupted(store, undefined, () => false)).toEqual({ holding: new Set(), notNoted: false });
    expect(store.sales[0]!.receipt?.interrupted).toBe(true);
  });
});

function notes(sales: SettledSale[]): SettledStore & { sales: SettledSale[] } {
  const store = {
    sales,
    read: () => store.sales,
    write: (next: SettledSale[]) => {
      store.sales = next;
      return true;
    },
  };
  return store;
}
const note = (key: string, extra: Partial<SettledSale> = {}): SettledSale => ({
  key,
  businessId: 1,
  userId: 2,
  documentId: 7,
  number: 'F-1',
  total: 5,
  at: '2026-11-20T10:00:00Z',
  // Notes older than a week go when another is written.
  settledAt: Date.now(),
  print: 'printed',
  ...extra,
});

describe('a fiscal number 4VD says not yet to', () => {
  it('should keep the number on a filed month, wait on no answer or another person, and drop it only on a clear no', () => {
    expect(fiscalFailure(new ApiError('October is filed', 409, 'PERIOD_FILED'))).toBe('blocked');
    expect(fiscalFailure(new ApiError('2025 is closed', 409, 'YEAR_CLOSED'))).toBe('blocked');
    expect(fiscalFailure(new ApiError('Someone else is signed in', 409, 'OWNER_CHANGED'))).toBe('wait');
    expect(fiscalFailure(new ApiError('TREFIN history', 409, null))).toBe('drop');
    expect(fiscalFailure(new TypeError('Failed to fetch'))).toBe('wait');
    expect(fiscalFailure(new ApiError('Busy', 503, null))).toBe('wait');
    expect(fiscalFailure(new ApiError('Signed out', 401, null))).toBe('wait');
    expect(fiscalFailure(new ApiError('No such invoice', 404, null))).toBe('drop');
  });

  it('should stay with why, show in its business, and go only once it is on the invoice or let go', () => {
    const store = notes([note('a', { followUp: { fiscalNo: '00042' } }), note('b', { businessId: 9, followUp: { fiscalNo: '1' } })]);
    noteBlocked(store, 'a', 'October is filed with ATK');
    noteBlocked(store, 'b', 'closed');
    expect(settledSale(store, 'a')?.followUp).toEqual({ fiscalNo: '00042', blocked: 'October is filed with ATK' });
    expect(blockedIn(store, 1).map((one) => one.key)).toEqual(['a']);
    followUpDone(store, 'a', 'fiscalNo');
    expect(settledSale(store, 'a')?.followUp).toBeUndefined();
    expect(blockedIn(store, 1)).toEqual([]);
  });

  it('should mark "check the printer" on a receipt the app says it lost track of', () => {
    const store = notes([note('a', { print: 'printing', text: 'job' }), note('b', { print: 'printed' })]);
    markCheck(store, 'a', 'Check the printer');
    markCheck(store, 'b', 'Check the printer');
    expect(settledSale(store, 'a')).toMatchObject({ print: 'check', followUp: { unprinted: 'Check the printer' } });
    expect(settledSale(store, 'b')?.print).toBe('printed');
  });
});
