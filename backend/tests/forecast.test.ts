import { describe, expect, it } from 'vitest';
import { forecast, weekdayIn } from '../src/services/reports/forecast.js';

const DAY = 24 * 60 * 60 * 1000;
// A Friday, at noon in Budapest.
const NOW = new Date('2026-10-02T10:00:00Z');
const TZ = 'Europe/Budapest';
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const longAgo = daysAgo(400);

/** One sale of `units` on each of the last `days` days. */
const steadySales = (days: number, units: number, from = 0) =>
  Array.from({ length: days }, (_, index) => ({ at: daysAgo(from + index + 0.5), units }));

describe('forecast', () => {
  it('should spread steady sales evenly and order for 30 days plus the buffer', () => {
    const result = forecast({ sales: steadySales(56, 1), now: NOW, availableSince: longAgo, stock: 10, reorderLevel: 5, timeZone: TZ });

    expect(result).toEqual({ averageDailySales: 1, daysLeft: 10, suggestedOrder: 25, trend: 'steady' });
  });

  it('should give no run-out date and only the buffer when nothing sells', () => {
    const result = forecast({ sales: [], now: NOW, availableSince: longAgo, stock: 4, reorderLevel: 10, timeZone: TZ });

    expect(result).toEqual({ averageDailySales: 0, daysLeft: null, suggestedOrder: 6, trend: 'steady' });
  });

  it('should weigh the last two weeks double, so a product picking up runs out sooner', () => {
    // 6 quiet weeks at 1 a day, then 2 busy weeks at 4 a day.
    const sales = [...steadySales(14, 4), ...steadySales(42, 1, 14)];

    const result = forecast({ sales, now: NOW, availableSince: longAgo, stock: 30, reorderLevel: 0, timeZone: TZ });

    // (2 × 4 + 1) / 3 = 3 a day, against a plain average of 1.75.
    expect(result.averageDailySales).toBe(3);
    expect(result.trend).toBe('rising');
    expect(result.daysLeft).toBeLessThanOrEqual(11);
  });

  it('should not count the days before a new product existed', () => {
    const result = forecast({
      sales: steadySales(10, 2),
      now: NOW,
      availableSince: daysAgo(10),
      stock: 20,
      reorderLevel: 0,
      timeZone: TZ,
    });

    expect(result.averageDailySales).toBe(2);
    expect(result.trend).toBeNull();
  });

  it('should stretch a brand-new product’s history to a week', () => {
    const result = forecast({
      sales: [{ at: daysAgo(0.1), units: 14 }],
      now: NOW,
      availableSince: daysAgo(0.2),
      stock: 14,
      reorderLevel: 0,
      timeZone: TZ,
    });

    expect(result.averageDailySales).toBe(2);
    expect(result.daysLeft).toBe(7);
  });

  it('should expect busy weekdays to sell more', () => {
    // 8 weeks: 7 units every Saturday, 1 on every other day.
    const sales = Array.from({ length: 56 }, (_, index) => {
      const at = daysAgo(index + 0.5);
      return { at, units: weekdayIn(at, TZ) === 6 ? 7 : 1 };
    });

    // Friday noon with 2 in stock: Friday takes ~1, then Saturday's ~7 can't be met.
    const result = forecast({ sales, now: NOW, availableSince: longAgo, stock: 2, reorderLevel: 0, timeZone: TZ });

    expect(result.daysLeft).toBe(1);
  });
});
