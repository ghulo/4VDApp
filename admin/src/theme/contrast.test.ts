import { describe, expect, it } from 'vitest';
import stylesheet from '../styles/tokens.css?raw';
import { contrastRatio } from './contrast';

// Normalise Windows line endings so the selectors below match either way.
const css = stylesheet.replace(/\r\n/g, '\n');

function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`No ${selector} block in tokens.css`);
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
}

/** The colour scales (`--amber-400: #f5b71a`) the theme blocks point at. */
const SCALES = Object.fromEntries(
  [...block(':root {\n  --neutral-').matchAll(/--([a-z]+-\d+):\s*(#[0-9a-fA-F]{6})/g)].map((match) => [match[1], match[2]]),
);

/** The `--name` colours inside the first block that starts with `selector`, as hex, following `var(--scale-step)`. */
function tokens(selector: string): Record<string, string> {
  return Object.fromEntries(
    [...block(selector).matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6}|var\(--([a-z]+-\d+)\))/g)].map((match) => [
      match[1],
      match[3] ? SCALES[match[3]] : match[2],
    ]),
  );
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
  // Unchosen segments sit on the segmented track; a chosen filter chip is ink on it.
  ['ink-muted', 'fill', 4.5],
  ['ink', 'fill', 4.5],
  ['brand-ink', 'brand', 4.5],
  ['brand', 'surface', 4.5],
  ['brand', 'brand-soft', 4.5],
  ['cta-ink', 'cta', 4.5],
  ['cta-ink', 'cta-top', 4.5],
  ['cta-ink', 'cta-low', 4.5],
  ['brand', 'tint', 4.5],
  ['ink', 'tint', 4.5],
  ['ink', 'amber-wash', 4.5],
  ['accent', 'surface', 3],
  ['danger', 'surface', 4.5],
  ['ok', 'ok-soft', 4.5],
  ['warn', 'warn-soft', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['info', 'info-soft', 4.5],
  // Badges are stamps: status-coloured words straight on paper.
  ['warn', 'surface', 4.5],
  ['ok', 'surface', 4.5],
  ['info', 'surface', 4.5],
  // Status words also sit on the canvas and on oat panels.
  ['ok', 'bg', 4.5],
  ['warn', 'bg', 4.5],
  ['danger', 'bg', 4.5],
  ['info', 'bg', 4.5],
  ['ok', 'fill', 4.5],
  ['warn', 'fill', 4.5],
  ['danger', 'fill', 4.5],
  ['info', 'fill', 4.5],
  // The danger key: paper words on danger.
  ['surface', 'danger', 4.5],
  ['focus', 'surface', 3],
  ['focus', 'bg', 3],
  // No ring sits on the amber key itself: every focus outline stands 2-3px off
  // its control, on paper (checked above); the key's words are cta-ink on cta.
  // Count badges and the chart tooltip: paper-coloured text on ink.
  ['surface', 'ink', 4.5],
  // The disabled main button: muted words on the fill.
  ['ink-muted', 'fill', 3],
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
