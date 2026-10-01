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
