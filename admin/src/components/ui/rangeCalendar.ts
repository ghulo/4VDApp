/** Calendar maths for the date range picker: days as "2026-11-26", weeks from Monday (Kosovo). */

export const toIso = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** The day `days` after (or before) an ISO day, on the calendar, whatever the clocks do. */
export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

/** A month's weeks, Monday first; days outside the month are null so the grid keeps its shape. */
export function monthWeeks(year: number, month: number): Array<Array<string | null>> {
  const first = new Date(Date.UTC(year, month, 1));
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: Array<string | null> = [...Array<null>(lead).fill(null)];
  for (let day = 1; day <= length; day++) cells.push(toIso(year, month, day));
  while (cells.length % 7) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let at = 0; at < cells.length; at += 7) weeks.push(cells.slice(at, at + 7));
  return weeks;
}

/**
 * A click on a day: the first click starts a new range; the second ends it, and a
 * day before the start swaps them, so the range always runs forward.
 */
export function pickDay(range: { from: string; to: string }, day: string): { from: string; to: string; done: boolean } {
  if (!range.from || range.to) return { from: day, to: '', done: false };
  return day < range.from ? { from: day, to: range.from, done: true } : { from: range.from, to: day, done: true };
}

/** Where a day sits in the range being picked (with the hovered day standing in for a missing end). */
export function dayPlace(day: string, from: string, to: string): 'start' | 'end' | 'single' | 'inside' | null {
  if (!from) return null;
  const [start, end] = to ? [from, to] : [from, from];
  const [low, high] = start <= end ? [start, end] : [end, start];
  if (day === low && day === high) return 'single';
  if (day === low) return 'start';
  if (day === high) return 'end';
  return day > low && day < high ? 'inside' : null;
}
