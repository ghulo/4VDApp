import { albanianDate, albanianMoney, albanianNumber } from '../i18n/albanianFormat';
import type { Language } from '../i18n/language';

let current: Language = 'en';

/** Called by the language provider; all formatting below follows it. */
export function setFormatLanguage(language: Language): void {
  current = language;
}

/** English formatters are slow to build, so keep one per format. Albanian is written by hand (see albanianFormat). */
const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, build: () => T): T {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key) as T;
}

export const formatMoney = (amount: number) =>
  current === 'sq'
    ? albanianMoney(amount)
    : cached('money', () => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })).format(amount);

/** Whole euros for chart axes: "€1.2K" in English, "1200 €" in Albanian. */
export const formatCompactMoney = (amount: number) =>
  current === 'sq'
    ? `${albanianNumber(Math.round(amount), 0)}${String.fromCharCode(160)}€`
    : cached(
        'compact-money',
        () => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }),
      ).format(amount);

/** 0.125 → "12.5%" ("12,5%" in Albanian). */
/** A rise above this (+300%, four times as much) reads as noise in percent, so it's said in words. */
export const MUCH_MORE = 3;

export const formatPercent = (fraction: number) =>
  current === 'sq'
    ? `${albanianNumber(fraction * 100, 1).replace(/,0$/, '')}%`
    : cached('percent', () => new Intl.NumberFormat('en-IE', { style: 'percent', maximumFractionDigits: 1 })).format(fraction);

/** Any date in the current language, e.g. { month: 'long', year: 'numeric' } → "October 2026" / "tetor 2026". */
export const formatDateWith = (date: Date, options: Intl.DateTimeFormatOptions) =>
  current === 'sq'
    ? albanianDate(date, options)
    : cached(JSON.stringify(options), () => new Intl.DateTimeFormat('en-GB', options)).format(date);

export const formatDate = (iso: string) => formatDateWith(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Promotion dates are whole UTC days and end at the start of the day after
 * the last one. `isEnd` shows that last day instead of the next morning.
 */
export const formatPromotionDay = (iso: string, isEnd = false) =>
  formatDateWith(new Date(new Date(iso).getTime() - (isEnd ? 1 : 0)), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
export const formatDateTime = (iso: string) =>
  formatDateWith(new Date(iso), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** "+5" / "−3": a real minus sign lines up with the plus in tabular figures. */
export const formatSignedQuantity = (quantity: number) => (quantity > 0 ? `+${quantity}` : `−${Math.abs(quantity)}`);
