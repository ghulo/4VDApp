import { describe, expect, it } from 'vitest';
import { margin, previousRange, relativeChange, reorderSuggestion } from '../src/services/reports/calculations.js';
import { toCsv } from '../src/utils/csv.js';

describe('relativeChange', () => {
  it('should return the change as a fraction', () => {
    expect(relativeChange(150, 100)).toBe(0.5);
    expect(relativeChange(75, 100)).toBe(-0.25);
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

describe('reorderSuggestion', () => {
  it('should estimate days left and how many to order for the next 30 days', () => {
    expect(reorderSuggestion({ unitsSoldLast30Days: 15, quantity: 15, reorderLevel: 10 })).toEqual({
      averageDailySales: 0.5,
      daysLeft: 30,
      suggestedOrder: 10,
    });
  });

  it('should round days left down', () => {
    expect(reorderSuggestion({ unitsSoldLast30Days: 30, quantity: 5, reorderLevel: 0 }).daysLeft).toBe(5);
    expect(reorderSuggestion({ unitsSoldLast30Days: 9, quantity: 10, reorderLevel: 0 }).daysLeft).toBe(33);
  });

  it('should not guess a run-out date without recent sales', () => {
    expect(reorderSuggestion({ unitsSoldLast30Days: 0, quantity: 4, reorderLevel: 10 })).toEqual({
      averageDailySales: 0,
      daysLeft: null,
      suggestedOrder: 6,
    });
  });

  it('should never suggest a negative order', () => {
    expect(reorderSuggestion({ unitsSoldLast30Days: 3, quantity: 500, reorderLevel: 10 }).suggestedOrder).toBe(0);
  });
});

describe('toCsv', () => {
  const columns = [
    { header: 'Product', value: (row: { name: string; qty: number | null }) => row.name },
    { header: 'Qty', value: (row: { name: string; qty: number | null }) => row.qty },
  ];

  it('should start with a BOM and use CRLF line endings', () => {
    expect(toCsv(columns, [{ name: 'Chair', qty: 2 }])).toBe('﻿Product,Qty\r\nChair,2\r\n');
  });

  it('should quote cells with commas, quotes or line breaks', () => {
    const csv = toCsv(columns, [{ name: 'Chair, "oak"\nlarge', qty: 1 }]);

    expect(csv).toContain('"Chair, ""oak""\nlarge",1');
  });

  it('should defuse cells that Excel would run as formulas', () => {
    const csv = toCsv(columns, [
      { name: '=HYPERLINK("x")', qty: 1 },
      { name: '+1', qty: 1 },
      { name: '-1', qty: 1 },
      { name: '@SUM(A1)', qty: 1 },
    ]);

    expect(csv).toContain(`"'=HYPERLINK(""x"")",1`);
    expect(csv).toContain("'+1,1");
    expect(csv).toContain("'-1,1");
    expect(csv).toContain("'@SUM(A1),1");
  });

  it('should leave numbers alone, including negative ones, and write null as empty', () => {
    expect(toCsv(columns, [{ name: 'Chair', qty: -3 }])).toContain('Chair,-3');
    expect(toCsv(columns, [{ name: 'Chair', qty: null }])).toContain('Chair,\r\n');
  });
});
