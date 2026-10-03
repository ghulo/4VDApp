import { createContext, useContext } from 'react';
import { type Catalogue, en } from './en';
import type { Language } from './language';
import { sq } from './sq';

export const CATALOGUES: Record<Language, Catalogue> = { en, sq };

interface I18nValue {
  language: Language;
  t: Catalogue;
  setLanguage: (next: Language) => void;
}

export const I18nContext = createContext<I18nValue | null>(null);

let active: Catalogue = en;

/** Called by the provider so plain functions (outside components) can use the current words. */
export function setActiveLanguage(language: Language): void {
  active = CATALOGUES[language];
}

/** The current words, for code that isn't a component (error helpers, formatters). */
export const activeCatalogue = (): Catalogue => active;

/** Outside the provider (a component rendered on its own) everything is English. */
const STANDALONE: I18nValue = { language: 'en', t: en, setLanguage: () => undefined };

function useI18n(): I18nValue {
  return useContext(I18nContext) ?? STANDALONE;
}

/** The words for the current language. */
export const useT = (): Catalogue => useI18n().t;

export function useLanguage() {
  const { language, setLanguage } = useI18n();
  return { language, setLanguage };
}
