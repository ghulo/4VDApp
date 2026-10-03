/**
 * Albanian money, numbers and dates written by hand. Many browsers and phones
 * ship without Albanian locale data, and Intl then quietly falls back to US
 * English ("€70.00"), so we don't rely on it. Spaces are non-breaking so an
 * amount never wraps onto two lines.
 */

const NBSP = String.fromCharCode(160);

const MONTHS_LONG = ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor'];
const MONTHS_SHORT = ['jan', 'shk', 'mar', 'pri', 'maj', 'qer', 'korr', 'gush', 'sht', 'tet', 'nën', 'dhj'];
const WEEKDAYS = ['e diel', 'e hënë', 'e martë', 'e mërkurë', 'e enjte', 'e premte', 'e shtunë'];

/** True when this browser or phone really has Albanian formatting built in. */
export function hasAlbanianIntl(): boolean {
  try {
    return new Intl.NumberFormat('sq-AL').resolvedOptions().locale.startsWith('sq');
  } catch {
    return false;
  }
}

/** 12.5 → "12,5"; thousands grouped with spaces from five digits up, as Albanian writes them. */
export function albanianNumber(value: number, fractionDigits: number): string {
  const [whole, fraction] = Math.abs(value).toFixed(fractionDigits).split('.');
  const grouped = whole!.length >= 5 ? whole!.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) : whole!;
  return `${value < 0 ? '-' : ''}${grouped}${fraction ? `,${fraction}` : ''}`;
}

/** 1204.5 → "1204,50 €". */
export function albanianMoney(amount: number): string {
  return `${albanianNumber(amount, 2)}${NBSP}€`;
}

/** The parts of a date in a time zone ("UTC" or the device's own). */
function parts(date: Date, timeZone: string | undefined) {
  const utc = timeZone === 'UTC';
  return {
    year: utc ? date.getUTCFullYear() : date.getFullYear(),
    month: utc ? date.getUTCMonth() : date.getMonth(),
    day: utc ? date.getUTCDate() : date.getDate(),
    weekday: utc ? date.getUTCDay() : date.getDay(),
    hour: utc ? date.getUTCHours() : date.getHours(),
    minute: utc ? date.getUTCMinutes() : date.getMinutes(),
  };
}

const twoDigits = (value: number) => String(value).padStart(2, '0');

/** The date options the apps use, written in Albanian: "7 tet 2026", "tetor 2026", "e mërkurë, 7 tetor", "14:05". */
export function albanianDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  const p = parts(date, options.timeZone);
  const months = options.month === 'long' ? MONTHS_LONG : MONTHS_SHORT;
  const dayMonth = [options.day && String(p.day), options.month && months[p.month], options.year && String(p.year)]
    .filter(Boolean)
    .join(' ');
  const time = options.hour ? `${twoDigits(p.hour)}:${twoDigits(p.minute)}` : '';
  const weekday = options.weekday ? WEEKDAYS[p.weekday]! : '';
  return [weekday, dayMonth, time].filter(Boolean).join(', ');
}
