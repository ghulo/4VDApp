import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepListed, loadDrafts, parseReceived, saveDrafts } from './deliveryDraft';

describe('parseReceived', () => {
  it('reads a blank box as not entered, never as 0', () => {
    expect(parseReceived('', 'piece')).toEqual({ kind: 'blank' });
    expect(parseReceived('   ', 'kg')).toEqual({ kind: 'blank' });
    expect(parseReceived('0', 'piece')).toEqual({ kind: 'number', value: 0 });
  });

  it('takes whole pieces only', () => {
    expect(parseReceived('12', 'piece')).toEqual({ kind: 'number', value: 12 });
    expect(parseReceived('2.5', 'piece')).toEqual({ kind: 'invalid' });
    expect(parseReceived('12', undefined)).toEqual({ kind: 'number', value: 12 });
    expect(parseReceived('1,5', undefined)).toEqual({ kind: 'invalid' });
  });

  it('takes kilos and litres to the gram, with a dot or the Albanian comma', () => {
    expect(parseReceived('2,5', 'kg')).toEqual({ kind: 'number', value: 2.5 });
    expect(parseReceived('0.775', 'l')).toEqual({ kind: 'number', value: 0.775 });
    expect(parseReceived(',5', 'm')).toEqual({ kind: 'number', value: 0.5 });
    expect(parseReceived('1.2345', 'kg')).toEqual({ kind: 'invalid' });
  });

  it('refuses what is not a number', () => {
    for (const text of ['-1', 'abc', '1e3', '1,2,3', '1.', '+2']) expect(parseReceived(text, 'kg')).toEqual({ kind: 'invalid' });
  });
});

describe('delivery drafts', () => {
  afterEach(() => vi.unstubAllGlobals());

  function memoryStorage() {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      store,
    };
  }

  it('keeps each business its own drafts', () => {
    const storage = memoryStorage();
    vi.stubGlobal('sessionStorage', storage);
    saveDrafts(1, { 7: { came: { 70: '3' }, expires: { 70: '2027-01-15' } } });
    expect(loadDrafts(1)).toEqual({ 7: { came: { 70: '3' }, expires: { 70: '2027-01-15' } } });
    expect(loadDrafts(2)).toEqual({});
    saveDrafts(1, {});
    expect(storage.store.size).toBe(0);
  });

  it('carries on without storage when it is blocked or holds junk', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => undefined,
    });
    expect(loadDrafts(1)).toEqual({});
    expect(() => saveDrafts(1, { 7: { came: {}, expires: {} } })).not.toThrow();

    const storage = memoryStorage();
    storage.setItem('4vd.deliveryDrafts.1', '{"7":{"came":{"70":5,"71":"2"},"expires":null},"8":3}');
    vi.stubGlobal('sessionStorage', storage);
    expect(loadDrafts(1)).toEqual({ 7: { came: { 71: '2' }, expires: {} } });
  });

  it('drops drafts of orders no longer on their way', () => {
    const drafts = { 7: { came: { 70: '3' }, expires: {} }, 8: { came: {}, expires: {} } };
    expect(keepListed(drafts, [8, 9])).toEqual({ 8: { came: {}, expires: {} } });
    expect(keepListed(drafts, [7, 8])).toBe(drafts);
  });
});
