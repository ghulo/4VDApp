/** The languages 4VD speaks. Each person picks one; it is saved on their account. */
export const LANGUAGES = ['en', 'sq'] as const;
export type Language = (typeof LANGUAGES)[number];

/** The locale used for dates and numbers in each language. */
export const LOCALE: Record<Language, string> = { en: 'en-IE', sq: 'sq-AL' };

/** Euros the way each language writes them: "€1,204.50" or "1.204,50 €". */
export function money(amount: number, language: Language): string {
  return new Intl.NumberFormat(LOCALE[language], { style: 'currency', currency: 'EUR' }).format(amount);
}

/** A whole number of euros without decimals when it has none ("€50"), else full money. */
export function wholeMoney(amount: number, language: Language): string {
  if (!Number.isInteger(amount)) return money(amount, language);
  return new Intl.NumberFormat(LOCALE[language], { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
}

export function dayMonth(date: Date, language: Language, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE[language] === 'en-IE' ? 'en-GB' : LOCALE[language], {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(date);
}
