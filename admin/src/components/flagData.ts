// Every flag file, as one lazy chunk (the small SVGs are inlined into it).
// components/CountryFlag.tsx fetches it the first time a flag or the country list is shown.
const FLAGS = import.meta.glob<string>('/node_modules/flag-icons/flags/4x3/*.svg', { query: '?url', import: 'default', eager: true });

export const flagUrl = (code: string): string | undefined => FLAGS[`/node_modules/flag-icons/flags/4x3/${code.toLowerCase()}.svg`];

/** Every two-letter country there is a flag for (Kosovo included). */
export const CODES = Object.keys(FLAGS).flatMap((path) => {
  const code = /\/([a-z]{2})\.svg$/.exec(path)?.[1];
  return code ? [code.toUpperCase()] : [];
});
