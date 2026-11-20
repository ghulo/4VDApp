import { describe, expect, it } from 'vitest';
import type { BasketSale } from '../../services/api';
import type { QueuedSale } from './offlineQueue';
import { followUpsFor, type SettledSale, type SettledStore, settledSale } from './settledSales';
import { noteSent } from './useWaitingSales';

function memoryStore(works = true): SettledStore & { sales: SettledSale[] } {
  const store = {
    sales: [] as SettledSale[],
    read: () => store.sales,
    write: (next: SettledSale[]) => {
      if (!works) return false;
      store.sales = next;
      return true;
    },
  };
  return store;
}

const job = { lines: [], payment: { by: 'card' as const } };
const waiting = (receipt: QueuedSale['receipt']): QueuedSale & { businessId: number } => ({
  key: 'k1',
  at: '2026-11-20T10:00:00Z',
  userId: 2,
  businessId: 1,
  body: { items: [{ productId: 5, quantity: 1 }], notes: null },
  total: 9,
  receipt,
});
const answer = { invoice: { id: 70, number: 'F-70' }, total: 9 } as BasketSale;
const owner = { businessId: 1, userId: 2 };

describe('a waiting sale sent to 4VD', () => {
  it('should keep, with who sold it, the printed receipt’s number to put on the invoice', () => {
    const store = memoryStore();
    expect(noteSent(waiting({ text: 'job', printed: true, fiscalNo: '00042', reason: '', job }), answer, store)).toBe(true);
    expect(settledSale(store, 'k1')).toMatchObject({ businessId: 1, userId: 2, documentId: 70, print: 'printed', followUp: { fiscalNo: '00042' } });
    expect(settledSale(store, 'k1')?.text).toBeUndefined();
    expect(followUpsFor(store, owner)).toHaveLength(1);
    expect(followUpsFor(store, { businessId: 3, userId: 2 })).toHaveLength(0);
  });

  it('should keep a receipt that didn’t print, for Not printed', () => {
    const store = memoryStore();
    noteSent(waiting({ text: 'job', printed: false, fiscalNo: null, reason: 'No paper', job }), answer, store);
    expect(settledSale(store, 'k1')).toMatchObject({ print: 'failed', text: 'job', job, followUp: { unprinted: 'No paper' } });
  });

  it('should leave a receipt cut off mid-print as printing, to be checked once the Windows app is done with it', () => {
    const store = memoryStore();
    noteSent(waiting({ text: '', printed: false, fiscalNo: null, reason: 'Check', job, interrupted: true }), answer, store);
    const note = settledSale(store, 'k1');
    expect(note).toMatchObject({ print: 'printing', job });
    expect(note?.followUp).toBeUndefined();
  });

  it('should say when its note could not be written', () => {
    expect(noteSent(waiting(null), answer, memoryStore(false))).toBe(false);
  });
});
