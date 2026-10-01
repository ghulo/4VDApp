import { describe, expect, it } from 'vitest';
import { resolvePeriod } from './periods';

// Local times, so the tests pass in any timezone.
const at = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
  new Date(year, month - 1, day, hour, minute, second);
const iso = (date: Date) => date.toISOString();

describe('resolvePeriod', () => {
  it('should give the same range for "Last 30 days" within the same minute, so the page does not refetch forever', () => {
    const first = resolvePeriod('last-30-days', undefined, at(2026, 10, 3, 10, 0, 5));
    const later = resolvePeriod('last-30-days', undefined, at(2026, 10, 3, 10, 0, 50));

    expect(later).toEqual(first);
  });

  it('should compare "This month so far" with the same days of last month', () => {
    const range = resolvePeriod('this-month', undefined, at(2026, 10, 3, 10, 0, 30));

    expect(range.startDate).toBe(iso(at(2026, 10, 1)));
    expect(range.endDate).toBe(iso(at(2026, 10, 3, 10, 1)));
    expect(range.previousStartDate).toBe(iso(at(2026, 9, 1)));
    expect(range.previousEndDate).toBe(iso(at(2026, 9, 3, 10, 1)));
  });

  it('should not let the comparison spill into this month when last month was shorter', () => {
    const range = resolvePeriod('this-month', undefined, at(2026, 3, 31, 12));

    // There is no 31 February: compare with the whole of February.
    expect(range.previousStartDate).toBe(iso(at(2026, 2, 1)));
    expect(range.previousEndDate).toBe(iso(at(2026, 3, 1)));
  });

  it('should compare last month with the whole month before it', () => {
    const range = resolvePeriod('last-month', undefined, at(2026, 3, 15));

    expect(range.startDate).toBe(iso(at(2026, 2, 1)));
    expect(range.endDate).toBe(iso(at(2026, 3, 1)));
    expect(range.previousStartDate).toBe(iso(at(2026, 1, 1)));
    expect(range.previousEndDate).toBe(iso(at(2026, 2, 1)));
  });

  it('should compare this year so far with the same part of last year', () => {
    const range = resolvePeriod('this-year', undefined, at(2026, 10, 3, 9, 59, 10));

    expect(range.startDate).toBe(iso(at(2026, 1, 1)));
    expect(range.endDate).toBe(iso(at(2026, 10, 3, 10, 0)));
    expect(range.previousStartDate).toBe(iso(at(2025, 1, 1)));
    expect(range.previousEndDate).toBe(iso(at(2025, 10, 3, 10, 0)));
  });

  it('should leave the comparison to the server for custom dates', () => {
    const range = resolvePeriod('custom', { from: '2026-03-01', to: '2026-03-10' }, at(2026, 10, 3));

    expect(range.previousStartDate).toBeUndefined();
    expect(range.previousEndDate).toBeUndefined();
  });

  it('should end a custom range at the next local midnight, even on a clock-change day', () => {
    // 25 October 2026 is 25 hours long in Europe, when the clocks go back.
    const range = resolvePeriod('custom', { from: '2026-10-20', to: '2026-10-25' }, at(2026, 11, 1));

    expect(range.endDate).toBe(iso(at(2026, 10, 26)));
  });

  it('should flag a custom range with only one date picked, instead of silently showing this month', () => {
    const range = resolvePeriod('custom', { from: '2026-03-01', to: '' }, at(2026, 10, 3));

    expect(range.waitingForDates).toBe(true);
    expect(resolvePeriod('custom', { from: '2026-03-01', to: '2026-03-02' }, at(2026, 10, 3)).waitingForDates).toBeUndefined();
  });
});
