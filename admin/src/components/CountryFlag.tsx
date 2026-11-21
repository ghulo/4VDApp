import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../i18n/useT';

// Flags as images, not emoji: Windows shows emoji flags as two letters, and
// images print on labels. The flag files (about 200 KB) load on their own,
// the first time a flag or the country list is shown, not with every page.
type FlagData = typeof import('./flagData');
let flagData: FlagData | null = null;
let flagLoad: Promise<FlagData> | null = null;

function useFlagData(): FlagData | null {
  const [data, setData] = useState<FlagData | null>(flagData);
  useEffect(() => {
    if (flagData) return;
    flagLoad ??= import('./flagData').then((loaded) => (flagData = loaded));
    let current = true;
    flagLoad.then(
      (loaded) => current && setData(loaded),
      () => {
        flagLoad = null;
      },
    );
    return () => {
      current = false;
    };
  }, []);
  return data;
}

/** Country names in the dashboard's language, and every country sorted by them (empty until the flag files have loaded). */
export function useCountries() {
  const { language } = useLanguage();
  const data = useFlagData();
  return useMemo(() => {
    const names = new Intl.DisplayNames([language], { type: 'region' });
    const name = (code: string) => names.of(code) ?? code;
    // Codes the browser has no name for (flag-only regions) are left out of the list.
    const all = (data?.CODES ?? [])
      .filter((code) => name(code) !== code)
      .map((code) => ({ code, name: name(code) }))
      .sort((a, b) => a.name.localeCompare(b.name, language));
    return { name, all };
  }, [language, data]);
}

/** A small flag. Decorative when the country's name is written next to it; otherwise the name is its text. */
export function CountryFlag({ code, decorative = false, className }: { code: string; decorative?: boolean; className?: string }) {
  const { name } = useCountries();
  const data = useFlagData();
  const classes = className ? `country-flag ${className}` : 'country-flag';
  // While the files load, hold the flag's place so nothing jumps.
  if (!data) return <span className={classes} style={{ width: 20, height: 15 }} aria-hidden="true" />;
  const src = data.flagUrl(code);
  if (!src) return null;
  return <img className={classes} src={src} width={20} height={15} alt={decorative ? '' : name(code)} title={decorative ? undefined : name(code)} />;
}
