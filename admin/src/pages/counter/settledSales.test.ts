import { describe, expect, it } from 'vitest';
import { followUpDone, followUpsFor, markInterrupted, MAX_SETTLED, notePrinted, noteSettled, type SettledSale, type SettledStore, settledSale } from './settledSales';

function memoryStore(sales: SettledSale[] = [], works = true): SettledStore & { sales: SettledSale[] } {
  const store = {
    sales,
    read: () => store.sales,
    write: (next: SettledSale[]) => {
      if (!works) return false;
      store.sales = next;
      return true;
    },
  };
  return store;
}

const sale = (key: string, extra: Partial<SettledSale> = {}): SettledSale => ({
  key,
  businessId: 1,
  userId: 2,
  documentId: 7,
  number: 'F-1',
  total: 5,
  at: '2026-11-20T10:00:00Z',
  settledAt: 1_000,
  print: 'none',
  ...extra,
});
const job = { lines: [], payment: { by: 'card' as const } };
const owner = { businessId: 1, userId: 2 };

describe('the settled sales note', () => {
  it('should find a settled sale by its key, and say when it could not be written', () => {
    const store = memoryStore();
    expect(noteSettled(store, sale('a'), 2_000)).toBe(true);
    expect(settledSale(store, 'a')?.number).toBe('F-1');
    expect(settledSale(store, 'b')).toBeUndefined();
    expect(noteSettled(memoryStore([], false), sale('a'))).toBe(false);
  });

  it('should keep the newest notes only, but never drop one with something still to do', () => {
    const store = memoryStore();
    noteSettled(store, sale('todo', { followUp: { fiscalNo: '00042' } }), 2_000);
    for (let index = 0; index < MAX_SETTLED + 5; index += 1) noteSettled(store, sale(`k${index}`, { settledAt: 1_000 }), 2_000);
    expect(store.sales).toHaveLength(MAX_SETTLED);
    expect(settledSale(store, 'k0')).toBeUndefined();
    expect(settledSale(store, 'todo')).toBeDefined();
    // A week later the old ones go, the one still to do stays.
    noteSettled(store, sale('late', { settledAt: 8 * 24 * 3600_000 }), 8 * 24 * 3600_000);
    expect(store.sales.map((one) => one.key)).toEqual(['todo', 'late']);
  });

  it('should keep a printed receipt’s number to put on the invoice, and drop the receipt', () => {
    const store = memoryStore([sale('a', { print: 'printing', text: 'job', job })]);
    expect(notePrinted(store, 'a', { ok: true, fiscalNo: '00042' })).toBe(true);
    expect(store.sales[0]).toEqual(sale('a', { print: 'printed', followUp: { fiscalNo: '00042' } }));
    expect(followUpsFor(store, owner).map((one) => one.key)).toEqual(['a']);
    followUpDone(store, 'a', 'fiscalNo');
    expect(store.sales[0]).toEqual(sale('a', { print: 'printed' }));
    expect(followUpsFor(store, owner)).toEqual([]);
  });

  it('should keep a failed receipt until Not printed has it', () => {
    const store = memoryStore([sale('a', { print: 'printing', text: 'job', job })]);
    notePrinted(store, 'a', { ok: false, reason: 'No paper' });
    expect(store.sales[0]).toMatchObject({ print: 'failed', text: 'job', job, followUp: { unprinted: 'No paper' } });
    followUpDone(store, 'a', 'unprinted');
    expect(store.sales[0]).toEqual(sale('a', { print: 'failed' }));
  });

  it('should give follow-ups only to the person and business that made the sale, once it is in 4VD', () => {
    const store = memoryStore([
      sale('mine', { followUp: { fiscalNo: '1' } }),
      sale('otherBusiness', { businessId: 9, followUp: { fiscalNo: '2' } }),
      sale('otherPerson', { userId: 9, followUp: { fiscalNo: '3' } }),
      sale('notSent', { documentId: 0, followUp: { unprinted: 'x' } }),
    ]);
    expect(followUpsFor(store, owner).map((one) => one.key)).toEqual(['mine']);
  });

  it('should mark "check the printer" on receipts a closed till left printing, never one printing now', () => {
    const store = memoryStore([
      sale('a', { print: 'printing', text: 'job', settledAt: 1_000 }),
      sale('busy', { print: 'printing', settledAt: 1_000 }),
      sale('new', { print: 'printing', settledAt: 9_000 }),
      sale('b', { print: 'printed' }),
    ]);
    markInterrupted(store, 5_000, 'Check the printer', (key) => key === 'busy');
    expect(settledSale(store, 'a')).toMatchObject({ print: 'check', text: 'job', followUp: { unprinted: 'Check the printer' } });
    expect(settledSale(store, 'busy')?.print).toBe('printing');
    expect(settledSale(store, 'new')?.print).toBe('printing');
    expect(settledSale(store, 'b')?.print).toBe('printed');
  });
});
