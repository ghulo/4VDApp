import { describe, expect, it } from 'vitest';
import { ApiError } from '../../services/apiClient';
import type { Product } from '../../services/types';
import { BurstWatcher, exactMatch, lookupFailure, nameMatches, stockDecision, tenderedLooksWrong } from './tillRules';

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
  const type = (watcher: BurstWatcher, keys: string, start: number, gap: number) => {
    let time = start;
    for (const key of keys) {
      watcher.key(key, time);
      time += gap;
    }
    return watcher.key('Enter', time);
  };

  it('gives the code when a burst of keys ends in a quick Enter', () => {
    expect(type(new BurstWatcher(), '5449000000996', 1000, 8)).toBe('5449000000996');
  });

  it('gives nothing for a hand typing an amount and pressing Enter', () => {
    expect(type(new BurstWatcher(), '20', 1000, 180)).toBeNull();
    expect(type(new BurstWatcher(), '2000', 1000, 120)).toBeNull();
  });

  it('gives nothing when the Enter comes slowly after the keys', () => {
    const watcher = new BurstWatcher();
    for (const [index, key] of [...'54490000'].entries()) watcher.key(key, 1000 + index * 5);
    expect(watcher.key('Enter', 2000)).toBeNull();
  });

  it('starts again after a hand-typed key', () => {
    const watcher = new BurstWatcher();
    watcher.key('1', 0);
    watcher.key('2', 500);
    expect(watcher.length).toBe(1);
    for (const [index, key] of [...'5449000'].entries()) watcher.key(key, 510 + index * 5);
    expect(watcher.key('Enter', 560)).toBe('25449000');
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
