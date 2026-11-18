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
