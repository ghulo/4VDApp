import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney, setFormatLanguage, formatHeadlineMoney, formatTimes } from './format';

afterEach(() => setFormatLanguage('en'));

describe('formatHeadlineMoney', () => {
  it('should drop the cents from €1,000 up and keep them below', () => {
    expect(formatHeadlineMoney(240769.4)).toBe('€240,769');
    expect(formatHeadlineMoney(999.5)).toBe('€999.50');
    expect(formatHeadlineMoney(-1200.2)).toBe('-€1,200');
  });
});

describe('formatTimes', () => {
  it('should say a rise as a multiple', () => {
    expect(formatTimes(4)).toBe('5×');
    expect(formatTimes(3.25)).toBe('4.3×');
    expect(formatTimes(62.4)).toBe('63×');
  });
});

describe('formatMoney', () => {
  it('should write euros the English way', () => expect(formatMoney(1204.5)).toBe('€1,204.50'));
  it('should write euros the Albanian way after switching', () => {
    setFormatLanguage('sq');
    // Albanian groups thousands with a space, and only from five digits up.
    expect(formatMoney(1204.5)).toMatch(/^1204,50\s€$/);
    expect(formatMoney(12045.5)).toMatch(/^12\s045,50\s€$/);
  });
});
