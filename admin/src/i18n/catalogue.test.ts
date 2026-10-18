import { describe, expect, it } from 'vitest';
import { en } from './en';
import { sq } from './sq';

/** Same in both languages on purpose. */
const SAME_IN_BOTH = new Set(['4VD', 'English', 'Shqip', 'Email', 'OK', 'Auto', 'Logo', 'SKU', 'NUI', 'IBAN', 'Excel', 'CSV', 'XK05 1212 0123 4567 8906', 'F-Link', 'TREFIN']);

/** Windows' own words, shown as Windows shows them (the download page's SmartScreen sketch). */
const WINDOWS_WORDS = '.download.warning.sketch.';

function strings(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => strings(child, `${path}.${key}`));
  }
  return [];
}

describe('catalogue', () => {
  it('should translate every English text', () => {
    const albanian = new Map(strings(sq));
    const untranslated = strings(en).filter(([path, text]) => albanian.get(path) === text && !SAME_IN_BOTH.has(text) && !path.startsWith(WINDOWS_WORDS));
    expect(untranslated).toEqual([]);
  });
});
