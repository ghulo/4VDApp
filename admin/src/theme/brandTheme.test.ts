import { describe, expect, it } from 'vitest';
import { brandInitials, brandTheme, fromOklch } from './brandTheme';
import { contrastRatio } from './contrast';

// The server's twin (backend/src/utils/brandColours.ts) checks the same colours, so emails match the dashboard.
const FIXTURES = [
  { hex: '#0f766e', key: { face: '#0f766e', top: '#2f8179', low: '#026a62', edge: '#004b45', ink: '#ffffff' }, words: { light: '#146a63', dark: '#7ecbc2' }, notes: [] },
  { hex: '#14284b', key: { face: '#14284b', top: '#203354', low: '#0b1e40', edge: '#000623', ink: '#ffffff' }, words: { light: '#485d80', dark: '#a4bce4' }, notes: ['darkWords'] },
  { hex: '#7cc4f0', key: { face: '#7cc4f0', top: '#8fd0f9', low: '#6fb7e3', edge: '#5098c2', ink: '#0f1010' }, words: { light: '#226386', dark: '#84c3eb' }, notes: [] },
  { hex: '#ffee00', key: { face: '#ffee00', top: '#fffab6', low: '#f1e105', edge: '#cdc003', ink: '#0f1010' }, words: { light: '#665e00', dark: '#ccbf03' }, notes: ['paleWords'] },
];

const token = (block: string, name: string) => block.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))?.[1] ?? '';

describe('brandTheme', () => {
  it.each(FIXTURES)('works out $hex the same as the server', ({ hex, key, words, notes }) => {
    const theme = brandTheme(hex, 'plain');
    expect(theme.key).toEqual(key);
    expect(theme.words).toEqual(words);
    expect(theme.notes).toEqual(notes);
  });

  it('keeps every word readable on any colour an owner can pick', () => {
    for (let L = 0.05; L <= 1; L += 0.06)
      for (let C = 0; C <= 0.32; C += 0.04)
        for (let H = 0; H < 360; H += 24)
          for (const greys of ['plain', 'tinted'] as const) {
            const hex = fromOklch(L, C, H);
            const theme = brandTheme(hex, greys);
            const [scale, light, dark] = theme.css.split('\n') as [string, string, string];
            const key = theme.key;
            for (const face of [key.face, key.top, key.low]) expect(contrastRatio(key.ink, face), `key ink on ${face} for ${hex}`).toBeGreaterThanOrEqual(4.5);
            const grey = (step: number, fallback: string) => token(scale, `neutral-${step}`) || fallback;
            const amber = (step: number) => token(scale, `amber-${step}`);
            for (const [block, paper] of [
              [light, [grey(50, '#f5f9fc'), grey(100, '#eef2f5'), amber(100), amber(150), amber(50)]],
              [dark, [grey(950, '#191a1a'), grey(975, '#0f1010'), amber(900), amber(925), amber(975)]],
            ] as const) {
              const brand = token(block, 'brand');
              for (const bg of paper) expect(contrastRatio(brand, bg), `brand words for ${hex}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(token(block, 'brand-ink'), brand)).toBeGreaterThanOrEqual(4.5);
            }
          }
  });

  it('keeps the developer mark in 4VD amber', () => {
    expect(brandTheme('#0f766e', 'plain').css).toContain('--dev-mark: #f5b71a');
  });

  it('writes nothing but colours into the stylesheet', () => {
    expect(brandTheme('#0F766E', 'tinted').css).toMatch(/^[\w\s:;#\-[\]'=(),.{}]+$/);
  });
});

describe('brandInitials', () => {
  it.each([
    ['Kafe Dardania', 'KD'],
    ['market', 'MA'],
    ['  çarshia e vjetër ', 'ÇE'],
    ['', '?'],
  ])('%s → %s', (name, initials) => expect(brandInitials(name)).toBe(initials));
});

describe('accent and gradient', () => {
  /** Every colour the gradient key's words sit on: main → accent, under the key's light and its shadow. */
  const alongKey = (from: string, to: string) => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const mix = (a: string, b: string, t: number) => `#${rgb(a).map((v, i) => Math.round(v + (rgb(b)[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
    return Array.from({ length: 21 }, (_, i) => mix(from, to, i / 20)).flatMap((c) => [c, mix(c, '#000000', 0.1)]);
  };

  it("leaves 4VD's own look untouched until its owner changes something", () => {
    expect(brandTheme('#f5b71a', 'plain', { keepMain: true }).css).toBe('');
  });

  it("changes only the charts and the marker when 4VD picks an accent", () => {
    const css = brandTheme('#f5b71a', 'plain', { keepMain: true, accent: '#3fbf8f' }).css;
    expect(css).toContain('--data-1:');
    expect(css).toContain('--nav-tick:');
    expect(css).not.toMatch(/--amber-\d|--cta:|--brand:|--accent:/);
  });

  it('draws the charts from the accent, never the brand words', () => {
    const theme = brandTheme('#0f766e', 'plain', { accent: '#e0a33a' });
    expect(token(theme.css.split('\n')[1]!, 'accent')).toBe(theme.words.light);
    expect(theme.css).toContain('--data-1:');
  });

  it('keeps the gradient key readable all along it, or keeps the key one colour and says so', () => {
    for (let L = 0.1; L <= 1; L += 0.15)
      for (let H = 0; H < 360; H += 45) {
        const main = fromOklch(L, 0.15, H);
        for (const accent of ['#e0a33a', '#14284b', '#3fbf8f', '#ffee00', '#e8664a']) {
          if (accent === main) continue;
          const theme = brandTheme(main, 'plain', { accent, gradient: true });
          expect(theme.gradient.mark, `logo key for ${main} → ${accent}`).not.toBeNull();
          if (theme.gradient.key) {
            for (const colour of alongKey(main, accent)) expect(contrastRatio(theme.key.ink, colour), `${main} → ${accent} at ${colour}`).toBeGreaterThanOrEqual(4.5);
          } else expect(theme.notes).toContain('flatKey');
        }
      }
  });

  it('keeps a far-apart pair one colour on the main key', () => {
    const theme = brandTheme('#ffee00', 'plain', { accent: '#14284b', gradient: true });
    expect(theme.gradient.key).toBeNull();
    expect(theme.notes).toContain('flatKey');
    expect(theme.css).not.toContain('--key-face');
    expect(theme.css).toContain('--mark-face');
  });

  it('has no gradient without an accent, or with the accent the same as the main colour', () => {
    expect(brandTheme('#0f766e', 'plain', { gradient: true }).gradient).toEqual({ key: null, mark: null });
    expect(brandTheme('#0f766e', 'plain', { accent: '#0F766E', gradient: true }).gradient).toEqual({ key: null, mark: null });
  });

  it('writes nothing but colours into the stylesheet, gradients included', () => {
    expect(brandTheme('#1d5fd1', 'tinted', { accent: '#e0a33a', gradient: true }).css).toMatch(/^[\w\s:;#\-[\]'=(),.{}]+$/);
  });
});


// The same main → accent pairs on both sides: whether the main key can carry the gradient, and its word colour.
const GRADIENTS = [
  { main: '#1d5fd1', accent: '#14284b', ink: '#ffffff', key: true, notes: [] },
  { main: '#0f766e', accent: '#e0a33a', ink: '#ffffff', key: false, notes: ['flatKey'] },
  { main: '#ffee00', accent: '#14284b', ink: '#0f1010', key: false, notes: ['paleWords', 'flatKey'] },
];

describe('gradient twins', () => {
  it.each(GRADIENTS)('decides $main → $accent the same on both sides', ({ main, accent, ink, key, notes }) => {
    const theme = brandTheme(main, 'plain', { accent, gradient: true });
    expect({ ink: theme.key.ink, key: theme.gradient.key !== null, notes: theme.notes }).toEqual({ ink, key, notes });
  });
});
