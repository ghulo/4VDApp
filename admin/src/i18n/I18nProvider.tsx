import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { setFormatLanguage } from '../utils/format';
import { CATALOGUES, I18nContext, setActiveLanguage } from './useT';
import { type Language, LANGUAGE_STORAGE_KEY, readLanguage, safeStorage } from './language';

/** Formats and tags the page; a choice someone made is also remembered for next time. */
function apply(language: Language, remember: boolean): void {
  setFormatLanguage(language);
  setActiveLanguage(language);
  document.documentElement.lang = language;
  if (!remember) return;
  try {
    safeStorage()?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Blocked storage: the language still applies for this visit.
  }
}

/**
 * English or Shqip for the whole dashboard. A switch re-renders every screen
 * through useT() without remounting, so half-typed forms keep their input.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const initial = readLanguage(safeStorage(), navigator.languages ?? [navigator.language]);
    apply(initial, false);
    return initial;
  });
  const setLanguage = useCallback((next: Language) => {
    apply(next, true);
    setLanguageState(next);
  }, []);
  const value = useMemo(() => ({ language, t: CATALOGUES[language], setLanguage }), [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
