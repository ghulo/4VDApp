export type Language = 'en' | 'sq';
export const LANGUAGES: Language[] = ['en', 'sq'];
export const LANGUAGE_STORAGE_KEY = '4vd.language';

export const isLanguage = (value: unknown): value is Language => value === 'en' || value === 'sq';

/** The saved choice; else the first language in the phone's list that 4VD speaks; else English. */
export function readLanguage(saved: string | null, deviceLanguages: readonly string[]): Language {
  if (isLanguage(saved)) return saved;
  for (const tag of deviceLanguages) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

/** The phone's own language, e.g. "sq-AL". */
export function deviceLanguages(): string[] {
  try {
    return [Intl.DateTimeFormat().resolvedOptions().locale];
  } catch {
    return [];
  }
}
