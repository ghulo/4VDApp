/**
 * Calendar dates and times as someone in `timeZone` would read them. Exports
 * use these so a sale at 00:30 on 1 September in Dublin isn't written (or
 * named) as 31 August.
 */
function parts(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

/** "2026-09-01" */
export function zonedDay(date: Date, timeZone: string): string {
  const { year, month, day } = parts(date, timeZone);
  return `${year}-${month}-${day}`;
}

/** "2026-09-01 00:30", a format Excel recognises as a date and time. */
export function zonedDateTime(date: Date, timeZone: string): string {
  const { year, month, day, hour, minute } = parts(date, timeZone);
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/** The hour (0–23) on the clock in `timeZone`. */
export function zonedHour(date: Date, timeZone: string): number {
  return Number(parts(date, timeZone).hour);
}

/** Midnight at the start of `date`'s day in `timeZone`, as a moment in time. */
export function startOfZonedDay(date: Date, timeZone: string): Date {
  const { year, month, day } = parts(date, timeZone);
  const midnightAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day));
  // How far the zone is ahead of UTC around then (DST changes happen at night, not midnight).
  const zoned = parts(new Date(midnightAsUtc), timeZone);
  const zonedAsUtc = Date.UTC(Number(zoned.year), Number(zoned.month) - 1, Number(zoned.day), Number(zoned.hour), Number(zoned.minute));
  return new Date(midnightAsUtc - (zonedAsUtc - midnightAsUtc));
}
