import { describe, expect, it } from 'vitest';
import { amountInWords } from '../src/i18n/amountInWords.js';
import { code128Svg, code128Values } from '../src/services/documents/code128.js';

describe('amount in words', () => {
  it('should write euros and cents in Albanian', () => {
    expect(amountInWords(29.1, 'sq')).toBe('njëzet e nëntë euro e dhjetë cent');
    expect(amountInWords(1, 'sq')).toBe('një euro');
    expect(amountInWords(0.5, 'sq')).toBe('zero euro e pesëdhjetë cent');
    expect(amountInWords(115, 'sq')).toBe('njëqind e pesëmbëdhjetë euro');
    expect(amountInWords(1250.75, 'sq')).toBe('një mijë e dyqind e pesëdhjetë euro e shtatëdhjetë e pesë cent');
    expect(amountInWords(2_000_000, 'sq')).toBe('dy milionë euro');
  });

  it('should write euros and cents in English', () => {
    expect(amountInWords(29.1, 'en')).toBe('twenty-nine euros and ten cents');
    expect(amountInWords(1.01, 'en')).toBe('one euro and one cent');
    expect(amountInWords(1205, 'en')).toBe('one thousand two hundred and five euros');
    expect(amountInWords(1005, 'en')).toBe('one thousand and five euros');
  });
});

describe('Code 128 barcode', () => {
  it('should add the start, the check symbol and the stop', () => {
    // "F" is 38 in set B: (104 + 38 × 1) mod 103 = 39.
    expect(code128Values('F')).toEqual([104, 38, 39, 106]);
  });

  it('should refuse characters set B cannot hold, and draw black bars on white', () => {
    expect(() => code128Values('Ç')).toThrow();
    expect(code128Svg('F-2026-000001')).toMatch(/^<svg[^>]*><rect[^>]*fill="#fff"\/><g fill="#000">/);
  });
});
