import { useMemo } from 'react';
import { useLanguage } from '../i18n/useT';

// Flags as images, not emoji: Windows shows emoji flags as two letters, and
// images print on labels. Each file is only downloaded when it is shown.
const FLAGS = import.meta.glob<string>('/node_modules/flag-icons/flags/4x3/*.svg', { query: '?url', import: 'default', eager: true });
const flagUrl = (code: string): string | undefined => FLAGS[`/node_modules/flag-icons/flags/4x3/${code.toLowerCase()}.svg`];

/** Every two-letter country there is a flag for (Kosovo included). */
const CODES = Object.keys(FLAGS).flatMap((path) => {
  const code = /\/([a-z]{2})\.svg$/.exec(path)?.[1];
  return code ? [code.toUpperCase()] : [];
});

/** Country names in the dashboard's language, and every country sorted by them. */
export function useCountries() {
  const { language } = useLanguage();
  return useMemo(() => {
    const names = new Intl.DisplayNames([language], { type: 'region' });
    const name = (code: string) => names.of(code) ?? code;
    // Codes the browser has no name for (flag-only regions) are left out of the list.
    const all = CODES.filter((code) => name(code) !== code)
      .map((code) => ({ code, name: name(code) }))
      .sort((a, b) => a.name.localeCompare(b.name, language));
    return { name, all };
  }, [language]);
}

/** A small flag. Decorative when the country's name is written next to it; otherwise the name is its text. */
export function CountryFlag({ code, decorative = false, className }: { code: string; decorative?: boolean; className?: string }) {
  const { name } = useCountries();
  const src = flagUrl(code);
  if (!src) return null;
  return (
    <img
      className={className ? `country-flag ${className}` : 'country-flag'}
      src={src}
      width={20}
      height={15}
      alt={decorative ? '' : name(code)}
      title={decorative ? undefined : name(code)}
    />
  );
}
