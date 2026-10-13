import { albanianDate, albanianMoney, albanianNumber } from '../i18n/albanianFormat';
import type { Language } from '../i18n/language';
import { activeCatalogue, setActiveLanguage } from '../i18n/useT';

let current: Language = 'en';

/** Called by the language provider; all formatting below follows it. */
export function setFormatLanguage(language: Language): void {
  current = language;
  setActiveLanguage(language);
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

/**
 * Money as a headline figure (the month on My sales, the day's sentence), as
 * on the dashboard: from €1,000 up the cents are dropped ("€240,769").
 */
export const formatHeadlineMoney = (amount: number) => {
  if (Math.abs(amount) < 1000) return formatMoney(amount);
  return current === 'sq'
    ? `${albanianNumber(Math.round(amount), 0)}${String.fromCharCode(160)}€`
    : cached(
        'money-whole',
        () => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, minimumFractionDigits: 0 }),
      ).format(amount);
};

/** Any date in the current language, e.g. { month: 'long' } → "October" / "tetor". */
export const formatDateWith = (date: Date, options: Intl.DateTimeFormatOptions) =>
  current === 'sq'
    ? albanianDate(date, options)
    : cached(JSON.stringify(options), () => new Intl.DateTimeFormat('en-GB', options)).format(date);

/**
 * "−15% until 7 Oct". Promotions end at the start of the day after their last day.
 * Promotion dates are whole UTC days, so they're shown in UTC: otherwise the end
 * (midnight UTC) would read as the next day east of London.
 */
export function promotionLabel(promotion: { percentOff: number; endsAt: string }): string {
  const lastDay = new Date(new Date(promotion.endsAt).getTime() - 1);
  const day = formatDateWith(lastDay, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `−${promotion.percentOff}% ${activeCatalogue().common.until(day)}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : activeCatalogue().common.somethingWrong;
}

/** A country's flag as emoji (phones draw these), from its two-letter code. */
export function flagEmoji(code: string): string {
  return [...code.toUpperCase()].map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65)).join('');
}

/** A country's name in the current language; the code itself where the phone has no names. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([current], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
