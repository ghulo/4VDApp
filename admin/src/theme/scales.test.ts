import { describe, expect, it } from 'vitest';

// The colour scales (--amber-400 and friends) live in tokens.css only, where the
// theme blocks map them to named tokens. Screens use --brand, --warn and so on,
// so a palette change stays one edit in one file.
const sources = import.meta.glob(['../**/*.{css,ts,tsx}', '!../styles/tokens.css', '!./scales.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const SCALE = /var\(--(?:neutral|amber|green|orange|red|blue)-\d+\)/g;

describe('colour scales', () => {
  it('should only be used inside tokens.css', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    const offenders = Object.entries(sources).flatMap(([file, text]) => (text.match(SCALE) ?? []).map((use) => `${file}: ${use}`));
    expect(offenders).toEqual([]);
  });
});
