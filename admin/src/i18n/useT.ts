import { createContext, useContext, useEffect, useState } from 'react';
import type { Catalogue } from './en';
import type { Language } from './language';

/**
 * Each language is its own file (about 300 KB of words), fetched when it is
 * needed, so a visit loads one of them instead of both. The saved copy keeps
 * both for offline use.
 */
const loaded: Partial<Record<Language, Catalogue>> = {};
const loading: Partial<Record<Language, Promise<Catalogue>>> = {};

/** Hands over a catalogue that is already in memory (tests; the loader below). */
export function registerCatalogue(language: Language, catalogue: Catalogue): void {
  loaded[language] = catalogue;
}

/** The words for a language, fetching its file the first time. */
export function loadCatalogue(language: Language): Promise<Catalogue> {
  const have = loaded[language];
  if (have) return Promise.resolve(have);
  loading[language] ??= (language === 'sq' ? import('./sq').then((module) => module.sq) : import('./en').then((module) => module.en))
    .then((catalogue) => {
      registerCatalogue(language, catalogue);
      return catalogue;
    })
    .finally(() => {
      // A failed fetch can be tried again; a loaded one is served from `loaded`.
      delete loading[language];
    });
  return loading[language];
}

/** The words for a language that is already loaded. The provider loads the shown one before it renders anything. */
export function catalogueFor(language: Language): Catalogue {
  const have = loaded[language];
  if (!have) throw new Error(`The ${language} words are not loaded yet`);
  return have;
}

interface I18nValue {
  language: Language;
  t: Catalogue;
  setLanguage: (next: Language) => void;
}

export const I18nContext = createContext<I18nValue | null>(null);

let active: Catalogue | null = null;

/** Called by the provider so plain functions (outside components) can use the current words. */
export function setActiveLanguage(language: Language): void {
  active = catalogueFor(language);
}

/** The current words, for code that isn't a component (error helpers, formatters). */
export const activeCatalogue = (): Catalogue => {
  const words = active ?? loaded.en ?? loaded.sq;
  if (!words) throw new Error('The words are not loaded yet');
  return words;
};

/** Outside the provider (a component rendered on its own, e.g. in a test) everything is English. */
const STANDALONE: I18nValue = {
  language: 'en',
  get t() {
    return loaded.en ?? activeCatalogue();
  },
  setLanguage: () => undefined,
};

function useI18n(): I18nValue {
  return useContext(I18nContext) ?? STANDALONE;
}

/** The words for the current language. */
export const useT = (): Catalogue => useI18n().t;

export function useLanguage() {
  const { language, setLanguage } = useI18n();
  return { language, setLanguage };
}

/** The words of one language that may not be the shown one (an invite's language, English search words); null until fetched. */
export function useCatalogue(language: Language): Catalogue | null {
  const [words, setWords] = useState<Catalogue | null>(loaded[language] ?? null);
  useEffect(() => {
    let current = true;
    loadCatalogue(language).then(
      (found) => current && setWords(found),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [language]);
  return words ?? loaded[language] ?? null;
}
