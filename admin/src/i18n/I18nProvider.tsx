import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setFormatLanguage } from '../utils/format';
import { I18nContext, catalogueFor, loadCatalogue, setActiveLanguage } from './useT';
import { type Language, LANGUAGE_STORAGE_KEY, readLanguage, safeStorage } from './language';

/** Formats and tags the page; a choice someone made is also remembered for next time. */
function apply(language: Language, remember: boolean): void {
  setFormatLanguage(language);
  setActiveLanguage(language);
  document.documentElement.lang = language;
  // The Windows app's own loading and offline pages follow along.
  window.fourvdDesktop?.setLanguage?.(language);
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
 * Only the shown language's words are fetched; the page waits for them.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => readLanguage(safeStorage(), navigator.languages ?? [navigator.language]));
  const first = useRef(language);
  const [ready, setReady] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    const initial = first.current;
    loadCatalogue(initial).then(
      () => {
        apply(initial, false);
        setReady('ready');
      },
      () => setReady('failed'),
    );
  }, []);

  const setLanguage = useCallback((next: Language) => {
    // The new words arrive first, then everything switches at once. If they can't be fetched, the shown language stays.
    loadCatalogue(next).then(
      () => {
        apply(next, true);
        setLanguageState(next);
      },
      () => undefined,
    );
  }, []);
  const value = useMemo(() => (ready === 'ready' ? { language, t: catalogueFor(language), setLanguage } : null), [ready, language, setLanguage]);

  if (ready === 'failed') {
    return (
      <p style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
        4VD could not load. Check the internet and <a href="/">try again</a>.
      </p>
    );
  }
  // The shown language's words are on their way; nothing can be written without them.
  if (!value) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
