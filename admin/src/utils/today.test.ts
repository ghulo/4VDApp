import { describe, expect, it } from 'vitest';
import { dayRange, startOfDay } from './today';

describe('dayRange', () => {
  it('should run from midnight to now while the day lasts', () => {
    const now = new Date(2026, 10, 21, 15, 30);
    const range = dayRange(startOfDay(now), now);
    expect(range.startDate).toBe(new Date(2026, 10, 21).toISOString());
    expect(range.endDate).toBe(now.toISOString());
    expect(range.previousStartDate).toBe(new Date(2026, 10, 14).toISOString());
  });

  it('should stop at the next midnight once that day is over', () => {
    const range = dayRange(new Date(2026, 10, 21), new Date(2026, 10, 22, 0, 5));
    expect(range.endDate).toBe(new Date(2026, 10, 22).toISOString());
  });
});
