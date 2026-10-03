import type { Language } from '../i18n/language';

const LOCALES: Record<Language, { money: string; date: string }> = {
  en: { money: 'en-IE', date: 'en-GB' },
  sq: { money: 'sq-AL', date: 'sq-AL' },
};
let current: Language = 'en';

/** Called by the language provider; all formatting below follows it. */
export function setFormatLanguage(language: Language): void {
  current = language;
}

/** Formatters are slow to build, so keep one per language and format. */
const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, build: () => T): T {
  const full = `${current}|${key}`;
  if (!cache.has(full)) cache.set(full, build());
  return cache.get(full) as T;
}

const money = () =>
  cached('money', () => new Intl.NumberFormat(LOCALES[current].money, { style: 'currency', currency: 'EUR' }));
const date = (options: Intl.DateTimeFormatOptions) =>
  cached(JSON.stringify(options), () => new Intl.DateTimeFormat(LOCALES[current].date, options));

export const formatMoney = (amount: number) => money().format(amount);
export const formatDate = (iso: string) => date({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/**
 * Promotion dates are whole UTC days and end at the start of the day after
 * the last one. `isEnd` shows that last day instead of the next morning.
 */
export const formatPromotionDay = (iso: string, isEnd = false) =>
  date({ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(new Date(iso).getTime() - (isEnd ? 1 : 0)),
  );
export const formatDateTime = (iso: string) =>
  date({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** "+5" / "−3": a real minus sign lines up with the plus in tabular figures. */
export const formatSignedQuantity = (quantity: number) => (quantity > 0 ? `+${quantity}` : `−${Math.abs(quantity)}`);
