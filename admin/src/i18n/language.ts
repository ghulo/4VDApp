import type { Language } from '../services/types';

export type { Language };
export const LANGUAGES: Language[] = ['en', 'sq'];
export const LANGUAGE_STORAGE_KEY = '4vd.language';

const isLanguage = (value: unknown): value is Language => value === 'en' || value === 'sq';

/** The saved choice; else the first language in the browser's list that 4VD speaks; else English. */
export function readLanguage(storage: Pick<Storage, 'getItem'> | null, browserLanguages: readonly string[]): Language {
  try {
    const saved = storage?.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // Blocked storage: decide from the browser.
  }
  for (const tag of browserLanguages) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

/** localStorage, or null when the browser blocks it. */
export function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True when someone already picked a language in this browser. */
export function hasSavedLanguage(): boolean {
  try {
    return safeStorage()?.getItem(LANGUAGE_STORAGE_KEY) != null;
  } catch {
    return false;
  }
}
