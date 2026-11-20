import { describe, expect, it } from 'vitest';
import { MAX_SETTLED, notePrinted, noteSettled, type SettledSale, type SettledStore, settledSale, takeInterrupted } from './settledSales';

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

const sale = (key: string, extra: Partial<SettledSale> = {}): SettledSale => ({ key, documentId: 7, number: 'F-1', total: 5, at: '2026-11-20T10:00:00Z', settledAt: 1_000, print: 'none', ...extra });

describe('the settled sales note', () => {
  it('should find a settled sale by its key, and say when it could not be written', () => {
    const store = memoryStore();
    expect(noteSettled(store, sale('a'), 2_000)).toBe(true);
    expect(settledSale(store, 'a')?.number).toBe('F-1');
    expect(settledSale(store, 'b')).toBeUndefined();
    expect(noteSettled(memoryStore([], false), sale('a'))).toBe(false);
  });

  it('should keep the newest notes only', () => {
    const store = memoryStore();
    for (let index = 0; index < MAX_SETTLED + 5; index += 1) noteSettled(store, sale(`k${index}`, { settledAt: 1_000 }), 2_000);
    expect(store.sales).toHaveLength(MAX_SETTLED);
    expect(settledSale(store, 'k0')).toBeUndefined();
    // A week later the old ones go.
    noteSettled(store, sale('late', { settledAt: 8 * 24 * 3600_000 }), 8 * 24 * 3600_000);
    expect(store.sales.map((one) => one.key)).toEqual(['late']);
  });

  it('should drop the receipt once it printed', () => {
    const store = memoryStore([sale('a', { print: 'printing', text: 'job', job: { lines: [], payment: { by: 'card' } } })]);
    notePrinted(store, 'a', 'printed');
    expect(store.sales[0]).toEqual(sale('a', { print: 'printed' }));
  });

  it('should hand back once the receipts a closed till left printing', () => {
    const store = memoryStore([sale('a', { print: 'printing', text: 'job' }), sale('b', { print: 'printed' })]);
    expect(takeInterrupted(store).map((one) => one.key)).toEqual(['a']);
    expect(settledSale(store, 'a')?.print).toBe('failed');
    expect(takeInterrupted(store)).toEqual([]);
  });
});
