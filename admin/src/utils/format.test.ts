import { afterEach, describe, expect, it } from 'vitest';
import { dayHeading, formatHeadlineMoney, formatMoney, formatTimes, groupByDay, setFormatLanguage } from './format';

afterEach(() => setFormatLanguage('en'));

describe('formatHeadlineMoney', () => {
  it('should drop the cents from €1,000 up and keep them below', () => {
    expect(formatHeadlineMoney(240769.4)).toBe('€240,769');
    expect(formatHeadlineMoney(999.5)).toBe('€999.50');
    expect(formatHeadlineMoney(-1200.2)).toBe('-€1,200');
  });

  it('should never show a negative zero', () => {
    expect(formatHeadlineMoney(-0)).toBe('€0.00');
    expect(formatMoney(-0.001)).toBe('€0.00');
  });
});

describe('formatTimes', () => {
  it('should say a rise as a multiple', () => {
    expect(formatTimes(4)).toBe('5×');
    expect(formatTimes(3.25)).toBe('4.3×');
    expect(formatTimes(8.2)).toBe('9.2×');
    expect(formatTimes(62.4)).toBe('10×+');
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

describe('dayHeading', () => {
  const words = { today: 'Today', yesterday: 'Yesterday' };
  const now = new Date(2026, 9, 12, 10, 0);

  it('should name today and yesterday, and spell out older days', () => {
    expect(dayHeading('2026-10-12', words, now)).toBe('Today');
    expect(dayHeading('2026-10-11', words, now)).toBe('Yesterday');
    expect(dayHeading('2026-10-09', words, now)).toBe('Friday 9 October');
    expect(dayHeading('2025-12-31', words, now)).toBe('Wednesday, 31 December 2025');
  });
});

describe('groupByDay', () => {
  it('should keep the order and start a new group when the local day changes', () => {
    const rows = [new Date(2026, 9, 12, 9).toISOString(), new Date(2026, 9, 12, 8).toISOString(), new Date(2026, 9, 11, 22).toISOString()];
    expect(groupByDay(rows, (row) => row).map((group) => [group.day, group.rows.length])).toEqual([
      ['2026-10-12', 2],
      ['2026-10-11', 1],
    ]);
  });
});
