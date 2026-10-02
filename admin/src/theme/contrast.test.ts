import { describe, expect, it } from 'vitest';
import stylesheet from '../styles/tokens.css?raw';
import { contrastRatio } from './contrast';

// Normalise Windows line endings so the selectors below match either way.
const css = stylesheet.replace(/\r\n/g, '\n');

/** The `--name: #hex` pairs inside the first block that starts with `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`No ${selector} block in tokens.css`);
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((match) => [match[1], match[2]]));
}

const THEMES = {
  light: tokens(":root,\n[data-theme='light']"),
  dark: tokens("[data-theme='dark']"),
};

// [foreground, background, minimum]: 4.5 for reading text, 3 for large text and UI parts.
const PAIRS: Array<[string, string, number]> = [
  ['ink', 'bg', 4.5],
  ['ink', 'surface', 4.5],
  ['ink-muted', 'surface', 4.5],
  ['ink-muted', 'bg', 4.5],
  ['ink-muted', 'surface-sunk', 4.5],
  ['brand-ink', 'brand', 4.5],
  ['brand', 'surface', 4.5],
  ['brand', 'brand-soft', 4.5],
  ['hero-ink', 'hero', 4.5],
  ['hero-muted', 'hero', 4.5],
  ['accent', 'surface', 3],
  ['danger', 'surface', 4.5],
  ['ok', 'ok-soft', 4.5],
  ['warn', 'warn-soft', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['info', 'info-soft', 4.5],
  ['warn', 'surface', 3],
  ['ok', 'surface', 3],
  ['focus', 'surface', 3],
];

describe('contrastRatio', () => {
  it('should match the WCAG examples', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe.each(Object.entries(THEMES))('%s theme colours', (_name, theme) => {
  it.each(PAIRS)('%s on %s should reach %s:1', (foreground, background, minimum) => {
    expect(theme[foreground], `--${foreground} missing`).toBeDefined();
    expect(theme[background], `--${background} missing`).toBeDefined();
    expect(contrastRatio(theme[foreground]!, theme[background]!)).toBeGreaterThanOrEqual(minimum);
  });
});
