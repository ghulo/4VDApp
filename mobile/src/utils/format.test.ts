import { afterEach, describe, expect, it } from 'vitest';
import { formatHeadlineMoney, formatMoney, promotionLabel, setFormatLanguage } from './format';

afterEach(() => setFormatLanguage('en'));

describe('format', () => {
  it('should write euros the English way', () => expect(formatMoney(1204.5)).toBe('€1,204.50'));

  it('should drop the cents from headline figures of €1,000 or more', () => {
    expect(formatHeadlineMoney(238694.4)).toBe('€238,694');
    expect(formatHeadlineMoney(35.5)).toBe('€35.50');
    setFormatLanguage('sq');
    expect(formatHeadlineMoney(238694.4)).toMatch(/^238\s694\s€$/);
  });

  it('should write euros the Albanian way after switching', () => {
    setFormatLanguage('sq');
    expect(formatMoney(12045.5)).toMatch(/^12\s045,50\s€$/);
  });

  it('should label a promotion in Albanian', () => {
    setFormatLanguage('sq');
    expect(promotionLabel({ percentOff: 15, endsAt: '2026-10-08T00:00:00Z' })).toMatch(/^−15% deri më 7 tet/);
  });
});
