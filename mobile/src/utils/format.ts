import type { Language } from '../i18n/language';
import { activeCatalogue, setActiveLanguage } from '../i18n/useT';

const LOCALES: Record<Language, { money: string; date: string }> = {
  en: { money: 'en-IE', date: 'en-GB' },
  sq: { money: 'sq-AL', date: 'sq-AL' },
};
let current: Language = 'en';

/** Called by the language provider; all formatting below follows it. */
export function setFormatLanguage(language: Language): void {
  current = language;
  setActiveLanguage(language);
}

/** Formatters are slow to build, so keep one per language and kind. */
const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, build: () => T): T {
  const full = `${current}|${key}`;
  if (!cache.has(full)) cache.set(full, build());
  return cache.get(full) as T;
}

export const formatMoney = (amount: number) =>
  cached('money', () => new Intl.NumberFormat(LOCALES[current].money, { style: 'currency', currency: 'EUR' })).format(amount);

// Promotion dates are whole UTC days, so they're shown in UTC: otherwise the end
// (midnight UTC) would read as the next day east of London.
const dayMonth = () =>
  cached('day-month', () => new Intl.DateTimeFormat(LOCALES[current].date, { day: 'numeric', month: 'short', timeZone: 'UTC' }));

/** "−15% until 7 Oct". Promotions end at the start of the day after their last day. */
export function promotionLabel(promotion: { percentOff: number; endsAt: string }): string {
  const lastDay = new Date(new Date(promotion.endsAt).getTime() - 1);
  return `−${promotion.percentOff}% ${activeCatalogue().common.until(dayMonth().format(lastDay))}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : activeCatalogue().common.somethingWrong;
}
