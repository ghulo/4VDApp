import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { secureStorage } from '../services/secureStorage';
import { setFormatLanguage } from '../utils/format';
import { deviceLanguages, type Language, LANGUAGE_STORAGE_KEY, readLanguage } from './language';
import { CATALOGUES, I18nContext } from './useT';

const initial = readLanguage(null, deviceLanguages());
setFormatLanguage(initial);

/** English or Shqip for the whole app. A choice someone made is remembered on this phone. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initial);

  useEffect(() => {
    secureStorage
      .getItem(LANGUAGE_STORAGE_KEY)
      .then((saved) => {
        const next = readLanguage(saved, deviceLanguages());
        setFormatLanguage(next);
        setLanguageState(next);
      })
      .catch(() => undefined); // unreadable storage: keep the phone's language
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setFormatLanguage(next);
    setLanguageState(next);
    secureStorage.setItem(LANGUAGE_STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ language, t: CATALOGUES[language], setLanguage }), [language, setLanguage]);
  // Screens re-render through useT(). Unlike the dashboard, nothing is remounted:
  // that would reset navigation and send someone back to Home mid-task.
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
