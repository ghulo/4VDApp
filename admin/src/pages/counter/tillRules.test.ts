import { describe, expect, it } from 'vitest';
import { ApiError } from '../../services/apiClient';
import type { Product } from '../../services/types';
import { BurstWatcher, exactMatch, lookupFailure, nameMatches, payEnter, payFailure, stockDecision, tenderedLooksWrong } from './tillRules';

const shelf = [
  { id: 1, name: 'Coca-Cola 500 ml', barcode: '5449000000996', otherBarcodes: ['5449000000002'], sku: 'CC500' },
  { id: 2, name: 'Fanta 500 ml', barcode: '5449000011527', otherBarcodes: [], sku: null },
  { id: 3, name: 'Bukë e bardhë', barcode: null, otherBarcodes: [], sku: '77' },
] as unknown as Product[];

describe('selling past what 4VD thinks is on the shelf', () => {
  it('lets anything that fits go in quietly', () => {
    expect(stockDecision({ stock: 5, already: 2, wanted: 3, rule: 'block', oversees: false })).toEqual({ kind: 'fits', quantity: 3 });
  });

  it('lets anyone sell past stock when the shop allows it, with a warning', () => {
    expect(stockDecision({ stock: 0, already: 0, wanted: 1, rule: 'allow', oversees: false })).toEqual({ kind: 'past', quantity: 1 });
    expect(stockDecision({ stock: -2, already: 1, wanted: 2, rule: 'allow', oversees: false })).toEqual({ kind: 'past', quantity: 2 });
  });

  it('lets an owner or admin sell past stock even when the shop refuses it', () => {
    expect(stockDecision({ stock: 0, already: 0, wanted: 1, rule: 'block', oversees: true })).toEqual({ kind: 'past', quantity: 1 });
  });

  it('refuses an employee past stock when the shop refuses it, keeping what the shelf holds', () => {
    expect(stockDecision({ stock: 0, already: 0, wanted: 1, rule: 'block', oversees: false })).toEqual({ kind: 'refused', quantity: 0 });
    expect(stockDecision({ stock: 3, already: 1, wanted: 5, rule: 'block', oversees: false })).toEqual({ kind: 'refused', quantity: 3 });
    // A line already past stock (put in by an owner) is never cut back.
    expect(stockDecision({ stock: 1, already: 4, wanted: 5, rule: 'block', oversees: false })).toEqual({ kind: 'refused', quantity: 4 });
    expect(stockDecision({ stock: -3, already: 0, wanted: 1, rule: 'block', oversees: false })).toEqual({ kind: 'refused', quantity: 0 });
  });
});

describe('telling the barcode scanner from a hand', () => {
  const type = (watcher: BurstWatcher, keys: string, start: number, gap: number, enterAfter = gap) => {
    let time = start;
    for (const key of keys) {
      watcher.key(key, time);
      time += gap;
    }
    return watcher.key('Enter', time - gap + enterAfter);
  };

  it('sees a burst of keys ending in a quick Enter, short codes too', () => {
    expect(type(new BurstWatcher(), '5449000000996', 1000, 8)).toEqual({ code: '5449000000996', burst: true });
    expect(type(new BurstWatcher(), '77', 1000, 8)).toEqual({ code: '77', burst: true });
  });

  it('still sees the scan when the scanner waits a little before its Enter', () => {
    expect(type(new BurstWatcher(), '5449000000996', 1000, 8, 200)).toEqual({ code: '5449000000996', burst: true });
    expect(type(new BurstWatcher(), '5449000000996', 1000, 8, 400)).toEqual({ code: '5449000000996', burst: false });
  });

  it('sees a hand typing an amount', () => {
    expect(type(new BurstWatcher(), '20', 1000, 180)).toEqual({ code: '0', burst: false });
    expect(type(new BurstWatcher(), '2000', 1000, 120)?.burst).toBe(false);
  });

  it('keeps capitals typed with Shift in the code', () => {
    const watcher = new BurstWatcher();
    let time = 0;
    for (const key of ['Shift', 'C', 'Shift', 'C', '5', '0', '0']) watcher.key(key, (time += 5));
    expect(watcher.key('Enter', time + 5)).toEqual({ code: 'CC500', burst: true });
  });

  it('gives nothing for an Enter with nothing typed (a second Enter)', () => {
    const watcher = new BurstWatcher();
    type(watcher, '5449000', 0, 5);
    expect(watcher.key('Enter', 60)).toBeNull();
  });
});

describe('an Enter in Pay', () => {
  const known = (code: string) => exactMatch(code, shelf) !== undefined;
  const enter = (keys: string, gap: number, enterAfter = gap) => {
    const watcher = new BurstWatcher();
    let time = 1000;
    for (const key of keys) {
      watcher.key(key, time);
      time += gap;
    }
    return payEnter(watcher.key('Enter', time - gap + enterAfter), known);
  };

  it('sends a scanned product back to the basket, short codes too, and never takes it as cash', () => {
    expect(enter('5449000000996', 8)).toEqual({ kind: 'product', code: '5449000000996' });
    expect(enter('77', 8)).toEqual({ kind: 'product', code: '77' });
    // The scanner waits a little before its Enter (a suffix delay): still the product.
    expect(enter('77', 8, 250)).toEqual({ kind: 'product', code: '77' });
  });

  it('records nothing for a scanned code that is no product', () => {
    expect(enter('4006381333931', 8)).toEqual({ kind: 'unknown', code: '4006381333931' });
  });

  it('pays for cash typed by hand, and for a quick short amount', () => {
    expect(enter('20', 180)).toEqual({ kind: 'pay' });
    expect(enter('2000', 120)).toEqual({ kind: 'pay' });
    // A fast hand: "50" with the keys close together, not a product: still the cash.
    expect(enter('50', 30)).toEqual({ kind: 'pay' });
    // Typed, then a pause, then Enter.
    expect(enter('5449000000996', 8, 900)).toEqual({ kind: 'pay' });
  });

  it('pays on a plain Enter with nothing typed just before', () => {
    expect(payEnter(null, known)).toEqual({ kind: 'pay' });
  });
});

describe('cash that is surely a mistake', () => {
  it('lets normal notes through', () => {
    expect(tenderedLooksWrong(50, 3.2)).toBe(false);
    expect(tenderedLooksWrong(100, 4)).toBe(false);
    expect(tenderedLooksWrong(500, 120)).toBe(false);
    expect(tenderedLooksWrong(12.6, 12.6)).toBe(false);
  });

  it('stops a scanned barcode or a huge amount', () => {
    expect(tenderedLooksWrong(5449000000996, 3.2)).toBe(true);
    expect(tenderedLooksWrong(700, 150)).toBe(true);
    expect(tenderedLooksWrong(200, 5)).toBe(true);
  });
});

describe('finding what was scanned or typed', () => {
  it('finds a barcode, another barcode, or the product number exactly', () => {
    expect(exactMatch('5449000000996', shelf)?.id).toBe(1);
    expect(exactMatch('5449000000002', shelf)?.id).toBe(1);
    expect(exactMatch('cc500', shelf)?.id).toBe(1);
    expect(exactMatch('77', shelf)?.id).toBe(3);
    expect(exactMatch('500', shelf)).toBeUndefined();
  });

  it('adds one product by a name with three letters or more', () => {
    expect(nameMatches('fanta', shelf)).toEqual({ products: [shelf[1]], addAtOnce: true });
    expect(nameMatches('bukë', shelf).addAtOnce).toBe(true);
  });

  it('never adds by name from digits or a couple of letters: the finder opens instead', () => {
    expect(nameMatches('500', shelf)).toEqual({ products: [shelf[0], shelf[1]], addAtOnce: false });
    expect(nameMatches('0 ml', shelf).addAtOnce).toBe(false);
    expect(nameMatches('uk', shelf)).toEqual({ products: [shelf[2]], addAtOnce: false });
    expect(nameMatches('', shelf)).toEqual({ products: [], addAtOnce: false });
  });

  it('tells "no such barcode" from "could not ask"', () => {
    expect(lookupFailure(new ApiError('Not found', 404, null))).toBe('notFound');
    expect(lookupFailure(new ApiError('Not a barcode', 400, null))).toBe('notFound');
    expect(lookupFailure(new ApiError('The server did not answer in time', 0, 'NETWORK'))).toBe('offline');
    expect(lookupFailure(new TypeError('Failed to fetch'))).toBe('offline');
    expect(lookupFailure(new ApiError('Server error', 500, null))).toBe('error');
  });
});

describe('a Record sale that failed', () => {
  it('frees the basket only when the server said no', () => {
    expect(payFailure(new ApiError('Not enough stock', 400, null))).toBe('refused');
    expect(payFailure(new ApiError('Signed out', 401, null))).toBe('refused');
    expect(payFailure(new ApiError('Month closed', 409, null))).toBe('refused');
  });

  it('keeps the same sale when it may have gone in', () => {
    expect(payFailure(new ApiError('The server did not answer in time', 0, 'NETWORK'))).toBe('offline');
    expect(payFailure(new TypeError('Failed to fetch'))).toBe('offline');
    expect(payFailure(new ApiError('Bad gateway', 502, null))).toBe('offline');
    expect(payFailure(new ApiError('Server error', 500, null))).toBe('unclear');
    expect(payFailure(new Error('something else'))).toBe('unclear');
  });
});
