import { describe, expect, it } from 'vitest';
import { margin, previousRange, relativeChange } from '../src/services/reports/calculations.js';
import { toCsv } from '../src/utils/csv.js';

describe('relativeChange', () => {
  it('should return the change as a fraction', () => {
    expect(relativeChange(150, 100)).toBe(0.5);
    expect(relativeChange(75, 100)).toBe(-0.25);
  });

  it('should show an improvement from a loss as a rise, not a fall', () => {
    expect(relativeChange(100, -100)).toBe(2);
    expect(relativeChange(-50, -100)).toBe(0.5);
  });

  it('should return null when there is nothing to compare against', () => {
    expect(relativeChange(100, 0)).toBeNull();
    expect(relativeChange(0, 0)).toBeNull();
  });
});

describe('previousRange', () => {
  it('should be the same length, ending where the current one starts', () => {
    const range = previousRange({
      startDate: new Date('2026-03-01T00:00:00Z'),
      endDate: new Date('2026-03-11T00:00:00Z'),
    });

    expect(range).toEqual({
      startDate: new Date('2026-02-19T00:00:00Z'),
      endDate: new Date('2026-03-01T00:00:00Z'),
    });
  });
});

describe('margin', () => {
  it('should divide profit by the revenue whose cost is known', () => {
    expect(margin(120, 300)).toBe(0.4);
  });

  it('should be null without revenue of known cost', () => {
    expect(margin(0, 0)).toBeNull();
  });
});
