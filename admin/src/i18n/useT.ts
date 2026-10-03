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

function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useT must be used inside <I18nProvider>');
  return value;
}

/** The words for the current language. */
export const useT = (): Catalogue => useI18n().t;

export function useLanguage() {
  const { language, setLanguage } = useI18n();
  return { language, setLanguage };
}
