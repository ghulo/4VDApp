import { albanianDate, albanianMoney } from '../i18n/albanianFormat';
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
