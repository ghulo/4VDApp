/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

/** Every source file's text, keyed like '/src/screens/HomeScreen.tsx'. */
const SOURCES = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

/** Files that must take every visible word from the catalogue. The translation task adds its files. */
const TRANSLATED = [
  'src/i18n/LanguageSwitch.tsx',
  'src/App.tsx',
  'src/components/Avatar.tsx',
  'src/components/Confirmation.tsx',
  'src/components/ExpiryPanel.tsx',
  'src/components/LogoMark.tsx',
  'src/components/MySales.tsx',
  'src/components/ProductCard.tsx',
  'src/components/PushSettingsPanel.tsx',
  'src/components/StockTag.tsx',
  'src/components/WelcomeTour.tsx',
  'src/components/inputs.tsx',
  'src/components/ui.tsx',
  'src/navigation/RootNavigator.tsx',
  'src/screens/AccountScreen.tsx',
  'src/screens/CatalogScreen.tsx',
  'src/screens/CountScreen.tsx',
  'src/screens/CountsScreen.tsx',
  'src/screens/DeliveriesScreen.tsx',
  'src/screens/ExpiryScreen.tsx',
  'src/screens/HomeScreen.tsx',
  'src/screens/LoginScreen.tsx',
  'src/screens/MySalesScreen.tsx',
  'src/screens/ProductDetailScreen.tsx',
  'src/screens/RecordSaleScreen.tsx',
  'src/screens/ReturnScreen.tsx',
  'src/screens/WriteOffScreen.tsx',
];

/** Brand and symbols that are fine to write directly. */
const ALLOWED = /^(4VD|Google|English|Shqip|[^A-Za-zËëÇç]*)$/;

/** JSX text matches can catch code between tags (`a < b ? (`); real words don't contain these. */
const CODE = /[=(){};?&|$]|\.\w/;

/** `} else {` and friends sit between braces too. */
const KEYWORD = /^(else|catch|finally|while|try|do|as const|from)\b/;

const PATTERNS = [
  /(?<![=-])>\s*([A-Za-zËëÇç][^<>{}]*?)\s*</g, // JSX text: <Text>Save changes</Text>, not `=> Promise<T>`
  /\b(?:placeholder|title|accessibilityLabel|accessibilityHint|label|hint)="([A-ZËÇ][^"]*|[^"]* [^"]*)"/g, // props: label="Theme"
  /\b(?:label|title|description|hint|placeholder|message|accessibilityLabel):\s*'([A-ZËÇ][^']*|[^']* [^']*)'/g, // fields: { label: 'Light' }
  /\}[ \t]*([A-Za-zËëÇç][^{}<>\n]*?)[ \t]*\{/g, // words between expressions: {price} each from {n}
];

function hardCoded(file: string): string[] {
  const source = SOURCES[`/${file}`];
  if (source === undefined) throw new Error(`${file} does not exist`);
  return PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]!.trim())).filter(
    (text) => text && !ALLOWED.test(text) && !CODE.test(text) && !KEYWORD.test(text),
  );
}

describe('no hard-coded English', () => {
  it.each(TRANSLATED)('%s takes its words from the catalogue', (file) => {
    expect(hardCoded(file)).toEqual([]);
  });
});
