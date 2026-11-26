import { describe, expect, it } from 'vitest';
import { addDays, dayPlace, monthWeeks, pickDay } from './rangeCalendar';

describe('monthWeeks', () => {
  it('starts weeks on Monday and keeps empty cells round the month', () => {
    // November 2026 starts on a Sunday: six empty cells before the 1st.
    const weeks = monthWeeks(2026, 10);
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks.at(-1)).toEqual(['2026-11-30', null, null, null, null, null, null]);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });
  it('knows a leap February', () => {
    expect(monthWeeks(2028, 1).flat().filter(Boolean).at(-1)).toBe('2028-02-29');
  });
});

describe('addDays', () => {
  it('crosses months, years and the clock change', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-03-28', 7)).toBe('2026-04-04');
  });
});

describe('pickDay', () => {
  it('first click starts, second ends, an earlier day swaps', () => {
    expect(pickDay({ from: '', to: '' }, '2026-11-10')).toEqual({ from: '2026-11-10', to: '', done: false });
    expect(pickDay({ from: '2026-11-10', to: '' }, '2026-11-20')).toEqual({ from: '2026-11-10', to: '2026-11-20', done: true });
    expect(pickDay({ from: '2026-11-10', to: '' }, '2026-11-02')).toEqual({ from: '2026-11-02', to: '2026-11-10', done: true });
    expect(pickDay({ from: '2026-11-10', to: '2026-11-20' }, '2026-11-15')).toEqual({ from: '2026-11-15', to: '', done: false });
  });
});

describe('dayPlace', () => {
  it('marks the ends and the days between, either way round', () => {
    expect(dayPlace('2026-11-10', '2026-11-10', '2026-11-12')).toBe('start');
    expect(dayPlace('2026-11-11', '2026-11-12', '2026-11-10')).toBe('inside');
    expect(dayPlace('2026-11-12', '2026-11-10', '2026-11-12')).toBe('end');
    expect(dayPlace('2026-11-10', '2026-11-10', '')).toBe('single');
    expect(dayPlace('2026-11-13', '2026-11-10', '2026-11-12')).toBeNull();
  });
});
