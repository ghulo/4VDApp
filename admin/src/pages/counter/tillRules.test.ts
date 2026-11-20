import { describe, expect, it } from 'vitest';
import { ApiError } from '../../services/apiClient';
import type { Product } from '../../services/types';
import { BurstWatcher, exactMatch, lookupFailure, basketStockProblem, nameMatches, payEnter, payFailure, stockDecision, tenderedLooksWrong } from './tillRules';

const shelf = [
  { id: 1, name: 'Coca-Cola 500 ml', barcode: '5449000000996', otherBarcodes: ['5449000000002'], sku: 'CC500', stock: { quantity: 10 } },
  { id: 2, name: 'Fanta 500 ml', barcode: '5449000011527', otherBarcodes: [], sku: null, stock: { quantity: 3 } },
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
    expect(type(new BurstWatcher(), '5449000000996', 1000, 8)).toEqual({ code: '5449000000996', burst: true, run: '5449000000996' });
    expect(type(new BurstWatcher(), '77', 1000, 8)).toMatchObject({ code: '77', burst: true });
  });

  it('still sees the scan when the scanner waits a little before its Enter', () => {
    expect(type(new BurstWatcher(), '5449000000996', 1000, 8, 200)).toMatchObject({ code: '5449000000996', burst: true });
    expect(type(new BurstWatcher(), '5449000000996', 1000, 8, 1500)).toMatchObject({ code: '5449000000996', burst: false });
  });

  it('sees a hand typing an amount', () => {
    expect(type(new BurstWatcher(), '20', 1000, 180)).toEqual({ code: '0', burst: false, run: '20' });
    expect(type(new BurstWatcher(), '2000', 1000, 120)?.burst).toBe(false);
  });

  it('keeps capitals typed with Shift in the code', () => {
    const watcher = new BurstWatcher();
    let time = 0;
    for (const key of ['Shift', 'C', 'Shift', 'C', '5', '0', '0']) watcher.key(key, (time += 5));
    expect(watcher.key('Enter', time + 5)).toMatchObject({ code: 'CC500', burst: true });
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
    expect(enter('77', 8, 700)).toEqual({ kind: 'product', code: '77' });
  });

  it('records nothing for a scanned code that is no product, short ones too', () => {
    expect(enter('4006381333931', 8)).toEqual({ kind: 'unknown', code: '4006381333931' });
    // "78" from a scanner (a product this till doesn't know yet) is never €78.
    expect(enter('78', 8)).toEqual({ kind: 'unknown', code: '78' });
    // A hand as fast as a scanner can't be told apart: it is asked too, never taken as cash.
    expect(enter('50', 30)).toEqual({ kind: 'unknown', code: '50' });
  });

  it('pays for cash typed by hand', () => {
    expect(enter('20', 180)).toEqual({ kind: 'pay' });
    expect(enter('2000', 120)).toEqual({ kind: 'pay' });
    expect(enter('50', 90)).toEqual({ kind: 'pay' });
    // Typed slowly, a pause, then Enter: no product has it.
    expect(enter('4006381', 150, 1500)).toEqual({ kind: 'pay' });
  });

  it('never takes a slow or one-key scan of a product as cash: it asks', () => {
    const withSeven = (code: string) => known(code) || code === '7';
    const slow = (keys: string, gap: number, enterAfter = gap) => {
      const watcher = new BurstWatcher();
      let time = 1000;
      for (const key of keys) {
        watcher.key(key, time);
        time += gap;
      }
      return payEnter(watcher.key('Enter', time - gap + enterAfter), withSeven);
    };
    // A one-character product number "7" scanned into a €5 sale: never €7 cash.
    expect(slow('7', 8)).toEqual({ kind: 'maybe', code: '7' });
    // A scanner with 80 ms between its keys.
    expect(slow('5449000000996', 80)).toEqual({ kind: 'maybe', code: '5449000000996' });
    // A scanner that waits 1.5 s before its Enter.
    expect(slow('5449000000996', 8, 1500)).toEqual({ kind: 'maybe', code: '5449000000996' });
    // Cash typed by hand, a pause, then a slow scan: only the scan is the run.
    const watcher = new BurstWatcher();
    watcher.key('2', 0);
    watcher.key('0', 200);
    watcher.key('7', 2000);
    watcher.key('7', 2090);
    expect(payEnter(watcher.key('Enter', 2180), withSeven)).toEqual({ kind: 'maybe', code: '77' });
    // An amount that is no product's number pays.
    expect(slow('20', 180)).toEqual({ kind: 'pay' });
  });

  it('starts a new run after a pause of a second', () => {
    const watcher = new BurstWatcher();
    expect(watcher.startsRun(0)).toBe(true);
    watcher.key('2', 0);
    expect(watcher.startsRun(500)).toBe(false);
    expect(watcher.startsRun(1200)).toBe(true);
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
  it('finds the exact case of a product number first, and another case only when just one has it', () => {
    const twins = [...shelf, { id: 4, name: 'A', barcode: null, otherBarcodes: [], sku: 'Ab1' }, { id: 5, name: 'B', barcode: null, otherBarcodes: [], sku: 'aB1' }, { id: 6, name: 'C', barcode: '5550001', otherBarcodes: [], sku: null }, { id: 7, name: 'D', barcode: null, otherBarcodes: [], sku: '5550001' }] as unknown as Product[];
    expect(exactMatch('Ab1', twins)?.id).toBe(4);
    expect(exactMatch('aB1', twins)?.id).toBe(5);
    expect(exactMatch('ab1', twins)).toBeUndefined();
    expect(exactMatch('5550001', twins)?.id).toBe(6);
  });

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
    expect(payFailure(new ApiError('Not enough stock', 400, 'VALIDATION_ERROR', true))).toBe('refused');
    expect(payFailure(new ApiError('Signed out', 401, null))).toBe('refused');
    expect(payFailure(new ApiError('Bad request', 400, 'VALIDATION_ERROR'))).toBe('refused');
  });

  it('keeps the sale for the person and business that made it when someone else is signed in now', () => {
    expect(payFailure(new ApiError('Someone else', 409, 'OWNER_CHANGED'))).toBe('otherOwner');
    expect(payFailure(new ApiError('Someone else', 409, 'OWNER_CHANGED'), true)).toBe('otherOwner');
  });

  it('keeps the same sale when it may have gone in', () => {
    expect(payFailure(new ApiError('The server did not answer in time', 0, 'NETWORK'))).toBe('offline');
    expect(payFailure(new TypeError('Failed to fetch'))).toBe('offline');
    expect(payFailure(new ApiError('Bad gateway', 502, null))).toBe('offline');
    expect(payFailure(new ApiError('Server error', 500, null))).toBe('unclear');
    expect(payFailure(new Error('something else'))).toBe('unclear');
  });
});

describe('a send again that failed', () => {
  it('stays unclear unless the server closed the sale for good', () => {
    // A copy sent before may still go in after an ordinary refusal: only a closed key frees the basket.
    expect(payFailure(new ApiError('Offer sold', 409, 'CONFLICT'), true)).toBe('unclear');
    expect(payFailure(new ApiError('Not enough stock', 400, 'VALIDATION_ERROR', true), true)).toBe('refused');
    expect(payFailure(new ApiError('Stopped', 410, 'GONE', true), true)).toBe('refused');
    expect(payFailure(new ApiError('Too many requests', 429, 'RATE_LIMITED'), true)).toBe('unclear');
    expect(payFailure(new ApiError('Signed out', 401, 'UNAUTHORIZED'), true)).toBe('unclear');
    expect(payFailure(new ApiError('Forbidden', 403, 'FORBIDDEN'), true)).toBe('unclear');
    expect(payFailure(new ApiError('Bad JSON', 400, 'BAD_REQUEST'), true)).toBe('unclear');
    expect(payFailure(new ApiError('Not enough stock', 400, 'VALIDATION_ERROR'), true)).toBe('unclear');
    expect(payFailure(new ApiError('Product gone', 404, 'NOT_FOUND'), true)).toBe('unclear');
  });

  it('a first send refused for any reason was never recorded, except a timeout or too many requests', () => {
    expect(payFailure(new ApiError('Signed out', 401, 'UNAUTHORIZED'))).toBe('refused');
    expect(payFailure(new ApiError('Too many requests', 429, 'RATE_LIMITED'))).toBe('unclear');
    expect(payFailure(new ApiError('Timeout', 408, null))).toBe('unclear');
  });
});

describe('the stock rule over the whole basket', () => {
  const line = (product: Product | undefined, quantity: number) => ({ productId: product?.id ?? 99, name: product?.name ?? 'Milk', quantity, product });
  it('refuses an employee a line past the shelf, or one whose stock 4VD can’t see', () => {
    expect(basketStockProblem([line(shelf[0], 1), line(shelf[1], 999)], 'block', false)).toEqual({ kind: 'over', product: shelf[1], quantity: 999 });
    expect(basketStockProblem([line(undefined, 1)], 'block', false)).toEqual({ kind: 'unknown', name: 'Milk' });
  });

  it('lets an owner, or a shop that allows it, sell anything', () => {
    expect(basketStockProblem([line(undefined, 1), line(shelf[1], 999)], 'block', true)).toBeNull();
    expect(basketStockProblem([line(undefined, 1)], 'allow', false)).toBeNull();
    expect(basketStockProblem([line(shelf[0], 1)], 'block', false)).toBeNull();
  });
});
