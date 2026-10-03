import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Files that must take every visible word from the catalogue. Each translation task adds its files. */
const TRANSLATED = ['src/i18n/LanguageSwitch.tsx'];

/** Brand and symbols that are fine to write directly. */
const ALLOWED = /^(4VD|English|Shqip|[^A-Za-zËëÇç]*)$/;

const PATTERNS = [
  />\s*([A-Za-zËëÇç][^<>{}]*?)\s*</g, // JSX text: <p>Save changes</p>
  /\b(?:placeholder|title|aria-label|alt|label|description|subtitle|hint)="([^"]+)"/g, // attributes: placeholder="Search"
  /\b(?:label|title|description|subtitle|hint|placeholder|message|group):\s*'([^']+)'/g, // fields: { label: 'Light' }
];

function hardCoded(file: string): string[] {
  const source = readFileSync(join(__dirname, '..', '..', file), 'utf8');
  return PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]!.trim())).filter(
    (text) => text && !ALLOWED.test(text),
  );
}

describe('no hard-coded English', () => {
  it.each(TRANSLATED)('%s takes its words from the catalogue', (file) => {
    expect(hardCoded(file)).toEqual([]);
  });
});
