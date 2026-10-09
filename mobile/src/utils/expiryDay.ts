/** "2026-10-12" as typed on a phone: day first, like in Kosovo and Albania. */
export const typedDayHint = '12.10.2026';

const pad = (n: number) => String(n).padStart(2, '0');

/** Turns "12.10.2026" (or 12/10/2026, 12-10-2026) into "2026-10-12". Null when it isn't a real date. */
export function parseTypedDay(text: string): string | null {
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Dates like 31.02 roll over into the next month; those are typos, not dates.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "2026-10-12" → "12.10.2026". */
export const toTypedDay = (day: string): string => day.split('-').reverse().join('.');

/** The day `days` after `from` (a local Date), as "YYYY-MM-DD". */
export function dayAfter(from: Date, days: number): string {
  const date = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate() + days));
  return date.toISOString().slice(0, 10);
}

/** Today on this phone's clock as "YYYY-MM-DD" (the shop and its staff share a time zone). */
export const today = (): string => dayAfter(new Date(), 0);
