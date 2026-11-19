/*
 * A business's own colours, worked out in the browser from the one colour its
 * owner picked (Settings → Business). The same maths as brand/make_palette.mjs,
 * which made 4VD's amber: an OKLCH ramp on 4VD's lightness ladder, so every
 * step is as light as the amber step it replaces and the layout's contrast
 * holds. The keys keep the owner's exact colour; words, outlines and the key's
 * ink take whichever shade reads (the contrast guard), and `notes` says what
 * was adjusted so Settings can tell the owner. The backend has a twin for
 * emails (backend/src/utils/brandColours.ts); both pass the same fixture test.
 */
import { contrastRatio } from './contrast';

export type BrandGreys = 'plain' | 'tinted';
/**
 * darkWords/paleWords: words take a readable shade; flatKey: no word colour reads all along the gradient, so the main key stays one colour;
 * flatMark: not even the logo's ink reads along it (3:1, as for graphics), so the logo and initials key stay one colour too and only the marker runs.
 */
export type BrandNote = 'darkWords' | 'paleWords' | 'flatKey' | 'flatMark';

export interface BrandExtras {
  /** A second colour for charts and the "where you are" marker; null = the main one. */
  accent?: string | null;
  /** Main → accent on the main key, the logo key and the marker. */
  gradient?: boolean;
  /** 4VD's own amber with its own scale (tokens.css): emit only the greys, accent and gradient, never a worked-out amber. */
  keepMain?: boolean;
}

/** What one theme (light or dark) looks like, as plain colours, for Settings' side-by-side previews. */
export interface BrandPreview {
  bg: string;
  surface: string;
  sunk: string;
  ink: string;
  muted: string;
  line: string;
  word: string;
  keyFace: string;
  keyInk: string;
  keyEdge: string;
  markFace: string;
  /** The logo tile's two ends (the same colour when there is no gradient). */
  markFrom: string;
  markTo: string;
  markInk: string;
  tick: string;
  data1: string;
  data3: string;
}

export interface BrandTheme {
  /** A stylesheet for <style id="brand-theme">: the scales plus the light and dark tokens that point at them. Empty when nothing differs from 4VD's own look. */
  css: string;
  /** What the guard changed, for the owner. */
  notes: BrandNote[];
  /** The key's colours, for previews and the placeholder logo. */
  /** markInk: the ink on the logo tile and initials key (reads along the gradient when they run). */
  key: { face: string; top: string; low: string; edge: string; ink: string; markInk: string };
  /** Brand words and outlines on paper, light and dark. */
  words: { light: string; dark: string };
  /** The ramp itself, 50 → 990, for the little strip under the picker. */
  ramp: Record<number, string>;
  /** The gradient faces (CSS backgrounds), or null where it is off: the main key (null too when its words wouldn't read) and the logo key. */
  gradient: { key: string | null; mark: string | null };
  /** Light and dark, as colours, for previews. */
  preview: { light: BrandPreview; dark: BrandPreview };
}

const hexToRgb = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255) as [number, number, number];
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** [lightness, chroma, hue°] of a #rrggbb colour. */
export function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

function oklabToRgb(L: number, A: number, B: number): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** The colour at (L, C, H), with chroma lowered until it fits on a screen. */
export function fromOklch(L: number, C: number, H: number): string {
  const lightness = Math.min(1, Math.max(0, L));
  for (let c = Math.max(0, C); c >= 0; c -= 0.001) {
    const rgb = oklabToRgb(lightness, c * Math.cos((H * Math.PI) / 180), c * Math.sin((H * Math.PI) / 180));
    if (rgb.every((v) => v >= -0.0001 && v <= 1.0001)) {
      return `#${rgb.map((v) => Math.round(fromLinear(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, '0')).join('')}`;
    }
  }
  const grey = Math.round(fromLinear(lightness ** 3) * 255).toString(16).padStart(2, '0');
  return `#${grey}${grey}${grey}`;
}

/** a → b at t (0…1), mixed the way a browser draws a gradient (sRGB). */
function mix(a: string, b: string, t: number): string {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return `#${x.map((v, i) => Math.round((v + (y[i]! - v) * t) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 975, 990] as const;
const HALF = [150, 250, 350, 450, 550, 650, 850, 925] as const;
const LADDER: Record<number, number> = { 50: 0.98, 100: 0.96, 200: 0.925, 300: 0.885, 400: 0.79, 500: 0.69, 600: 0.585, 700: 0.475, 800: 0.4, 900: 0.3, 950: 0.215, 975: 0.17, 990: 0.125 };
const CURVE: Record<number, number> = { 50: 0.1, 100: 0.2, 200: 0.32, 300: 0.48, 400: 0.9, 500: 0.95, 600: 1, 700: 0.9, 800: 0.6, 900: 0.3, 950: 0.18, 975: 0.12, 990: 0.07 };
const NEUTRAL_C: Record<number, number> = { 50: 0.006, 100: 0.006, 200: 0.006, 300: 0.006, 400: 0.005, 500: 0.0045, 600: 0.004, 700: 0.0035, 800: 0.003, 900: 0.0025, 950: 0.002, 975: 0.002, 990: 0.0015 };
/** "A touch of my colour": the greys lean towards it, twice as much as 4VD's faint blue. */
const TINT = 2;

/** 4VD's own developer mark keeps 4VD's amber in every business (tokens.css values). */
const DEV_MARK = { light: { mark: '#a66f02', text: '#7f5101' }, dark: { mark: '#f5b71a', text: '#f5b71a' } };

const WHITE = '#ffffff';
const BLACK = '#000000';
/** The light along the top of a key and the shadow at its foot, drawn over a gradient key (8-digit hex: no "/" in a stored sheet). */
const KEY_SHADE = 'linear-gradient(180deg, #ffffff33, #ffffff00, #0000001a)';

/** The paler-or-darker ink that reads best on a colour; at least 4.58:1 on any colour. */
const inkOn = (face: string, darkInk: string) => (contrastRatio(face, darkInk) >= contrastRatio(face, WHITE) ? darkInk : WHITE);

export const isBrandHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

/** An OKLCH ramp on 4VD's lightness ladder, with the half steps between. */
function rampOf(hex: string): Record<number, string> {
  const [, c0, h] = toOklch(hex);
  // A grey pick still gets a faint ramp; a neon one is held to amber's strength.
  const peak = Math.min(0.2, Math.max(0.02, c0));
  const ramp: Record<number, string> = {};
  for (const step of STEPS) ramp[step] = fromOklch(LADDER[step]!, peak * CURVE[step]!, h);
  for (const half of HALF) {
    const lo = Math.max(...STEPS.filter((s) => s < half));
    const hi = Math.min(...STEPS.filter((s) => s > half));
    const [la, ca] = toOklch(ramp[lo]!);
    const [lb, cb] = toOklch(ramp[hi]!);
    ramp[half] = fromOklch((la + lb) / 2, (ca + cb) / 2, h);
  }
  return ramp;
}

export function brandTheme(input: string, greys: BrandGreys, extras: BrandExtras = {}): BrandTheme {
  const hex = input.toLowerCase();
  const accentHex = extras.accent && isBrandHex(extras.accent) && extras.accent.toLowerCase() !== hex ? extras.accent.toLowerCase() : null;
  const keepMain = extras.keepMain === true;
  const [l0, c0, h] = toOklch(hex);
  const ramp = rampOf(hex);
  const neutral: Record<number, string> = {};
  if (greys === 'tinted') for (const step of STEPS) neutral[step] = fromOklch(LADDER[step]!, NEUTRAL_C[step]! * TINT, h);
  const grey = (step: number) => neutral[step] ?? NEUTRAL_HEX[step]!;

  // The key: the owner's colour, a lit top and a deeper foot of the same hue.
  // The ink is white or near-black, whichever reads; if the lit top or foot
  // would let it down, they step back towards the face until it reads.
  const darkInk = contrastRatio(hex, grey(975)) >= 4.5 || contrastRatio(hex, WHITE) >= 4.5 ? grey(975) : BLACK;
  let ink = inkOn(hex, darkInk);
  let lift = 0.04;
  let top = fromOklch(l0 + lift, c0 * 0.92, h);
  let low = fromOklch(l0 - lift, c0, h);
  while (lift > 0 && (contrastRatio(top, ink) < 4.5 || contrastRatio(low, ink) < 4.5)) {
    lift = Math.max(0, lift - 0.01);
    top = lift ? fromOklch(l0 + lift, c0 * 0.92, h) : hex;
    low = lift ? fromOklch(l0 - lift, c0, h) : hex;
  }
  const edge = fromOklch(Math.max(0.05, l0 - 0.14), c0, h);
  const hover = contrastRatio(fromOklch(l0 + 0.06, c0 * 0.85, h), ink) >= 4.5 ? fromOklch(l0 + 0.06, c0 * 0.85, h) : top;

  // Words and outlines: the usual step, or the next one that reads on paper,
  // on the canvas and on every brand wash the words sit on.
  const light = { surface: grey(50), bg: grey(100), soft: ramp[100]!, tint: ramp[150]!, wash: ramp[50]! };
  const dark = { surface: grey(950), bg: grey(975), soft: ramp[900]!, tint: ramp[925]!, wash: ramp[975]! };
  const reads = (colour: string, on: string[], ratio = 4.5) => on.every((bg) => contrastRatio(colour, bg) >= ratio);
  const firstThatReads = (from: Record<number, string>, order: number[], on: string[], fallback: string, ratio = 4.5) => order.map((s) => from[s]!).find((c) => reads(c, on, ratio)) ?? fallback;
  const lightOn = [light.surface, light.bg, light.soft, light.tint, light.wash];
  const darkOn = [dark.surface, dark.bg, dark.soft, dark.tint, dark.wash];
  const lightWord = firstThatReads(ramp, [700, 800, 900, 950], lightOn, grey(950));
  const darkWord = firstThatReads(ramp, [400, 300, 200, 100], darkOn, grey(50));

  const notes: BrandNote[] = [];
  if (!keepMain && contrastRatio(hex, dark.bg) < 1.6) notes.push('darkWords');
  if (!keepMain && contrastRatio(hex, light.bg) < 1.25) notes.push('paleWords');

  // The gradient runs main → accent. Its words must read all along it (luminance
  // can dip between two hues), and where the key's foot darkens it; the light
  // along the top fades out above the words. If no ink reads, the main key stays
  // one colour. The logo and initials key are graphics, so their ink needs 3:1
  // along it; below that they stay one colour too and only the marker runs.
  let keyGradient: string | null = null;
  let markGradient: string | null = null;
  let markInk = ink;
  if (extras.gradient && accentHex) {
    const shaded = `${KEY_SHADE}, linear-gradient(100deg, ${hex}, ${accentHex})`;
    const along = Array.from({ length: 11 }, (_, i) => mix(hex, accentHex, i / 10)).flatMap((colour) => [colour, mix(colour, BLACK, 0.1)]);
    const worst = (candidate: string) => Math.min(...along.map((colour) => contrastRatio(colour, candidate)));
    const best = [darkInk, WHITE, BLACK].sort((a, b) => worst(b) - worst(a))[0]!;
    if (worst(best) >= 4.5) {
      keyGradient = shaded;
      ink = best;
    } else notes.push('flatKey');
    if (worst(best) >= 3) {
      markGradient = shaded;
      markInk = best;
    } else notes.push('flatMark');
  }

  // The accent draws the charts and the marker; without one, the main colour does (tokens.css's own mapping).
  const accentRamp = accentHex ? rampOf(accentHex) : null;
  const ticks = {
    light: extras.gradient && accentHex ? `linear-gradient(180deg, ${hex}, ${accentHex})` : accentRamp ? firstThatReads(accentRamp, [500, 600, 700], [light.surface], accentRamp[700]!, 3) : null,
    dark: extras.gradient && accentHex ? `linear-gradient(180deg, ${hex}, ${accentHex})` : accentRamp ? firstThatReads(accentRamp, [400, 300, 200], [dark.surface], accentRamp[200]!, 3) : null,
  };
  const chartTokens = (map: [number, number, number, number, number, number, number]) =>
    accentRamp
      ? { 'data-1': accentRamp[map[0]]!, 'data-2': accentRamp[map[1]]!, 'data-3': accentRamp[map[2]]!, 'data-4': accentRamp[map[3]]!, 'data-5': accentRamp[map[4]]!, 'data-heat': accentRamp[map[5]]!, 'data-line': accentRamp[map[6]]! }
      : {};
  const lightCharts = chartTokens([700, 500, 400, 300, 200, 500, 600]);
  const darkCharts = chartTokens([300, 400, 500, 700, 800, 400, 400]);
  const shaded = { ...(keyGradient && { 'key-face': keyGradient }), ...(markGradient && { 'mark-face': markGradient }), ...(markGradient && accentHex && { 'mark-to': accentHex, 'mark-ink': markInk }) };

  const vars = (entries: Record<string, string | undefined>) =>
    Object.entries(entries)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([name, value]) => `--${name}: ${value};`)
      .join(' ');
  const scale = vars({
    ...(!keepMain && Object.fromEntries(Object.entries(ramp).map(([step, colour]) => [`amber-${step}`, colour]))),
    ...Object.fromEntries(Object.entries(neutral).map(([step, colour]) => [`neutral-${step}`, colour])),
  });
  const keyTokens = keepMain ? (keyGradient ? { 'cta-ink': ink } : {}) : { cta: hex, 'cta-top': top, 'cta-low': low, 'cta-hover': hover, 'cta-edge': edge, 'cta-ink': ink };
  const lightTokens = vars({
    ...keyTokens,
    ...(!keepMain && { brand: lightWord, 'brand-ink': inkOn(lightWord, BLACK), accent: lightWord, focus: lightWord, 'glass-deep': lightWord }),
    ...shaded,
    ...(ticks.light && { 'nav-tick': ticks.light }),
    ...lightCharts,
    // The developer badge keeps 4VD amber on 4VD's own colour, else takes the business's word shade (reads at 4.5:1).
    'dev-mark': keepMain ? DEV_MARK.light.mark : lightWord,
    'dev-mark-text': keepMain ? DEV_MARK.light.text : lightWord,
  });
  const darkTokens = vars({
    ...keyTokens,
    ...(!keepMain && { brand: darkWord, 'brand-ink': inkOn(darkWord, grey(975)), accent: darkWord, focus: darkWord, 'amber-mark': darkWord }),
    ...shaded,
    ...(ticks.dark && { 'nav-tick': ticks.dark }),
    ...darkCharts,
    'dev-mark': keepMain ? DEV_MARK.dark.mark : darkWord,
    'dev-mark-text': keepMain ? DEV_MARK.dark.text : darkWord,
  });
  // 4VD's own look with nothing changed: no sheet at all, tokens.css shows as it always has.
  const nothing = keepMain && greys === 'plain' && !accentHex;
  // html[...] outranks tokens.css's [data-theme] blocks, so these win without !important.
  const css = nothing ? '' : `html:root { ${scale} }\nhtml:root, html[data-theme='light'] { ${lightTokens} }\nhtml[data-theme='dark'] { ${darkTokens} }`;

  const flatFace = `linear-gradient(180deg, ${top}, ${hex}, ${low})`;
  const previewOf = (mode: 'light' | 'dark'): BrandPreview => {
    const isLight = mode === 'light';
    const data = accentRamp ?? ramp;
    return {
      bg: grey(isLight ? 100 : 975),
      surface: grey(isLight ? 50 : 950),
      sunk: grey(isLight ? 200 : 990),
      ink: grey(isLight ? 950 : 50),
      muted: grey(isLight ? 700 : 400),
      line: grey(isLight ? 200 : 900),
      word: isLight ? lightWord : darkWord,
      keyFace: keyGradient ?? flatFace,
      keyInk: ink,
      keyEdge: edge,
      markFace: markGradient ?? flatFace,
      markFrom: hex,
      markTo: markGradient && accentHex ? accentHex : hex,
      markInk,
      tick: ticks[mode] ?? hex,
      data1: data[isLight ? 700 : 300]!,
      data3: data[isLight ? 400 : 500]!,
    };
  };
  return {
    css,
    notes,
    key: { face: hex, top, low, edge, ink, markInk },
    words: { light: lightWord, dark: darkWord },
    ramp,
    gradient: { key: keyGradient, mark: markGradient },
    preview: { light: previewOf('light'), dark: previewOf('dark') },
  };
}

/** 4VD's own greys (tokens.css), used when a business keeps them plain. */
const NEUTRAL_HEX: Record<number, string> = {
  50: '#f5f9fc', 100: '#eef2f5', 200: '#e3e7ea', 300: '#d5dadc', 400: '#b8bbbd', 500: '#999c9e', 600: '#7a7c7e',
  700: '#5a5c5e', 800: '#464849', 900: '#2d2e2f', 950: '#191a1a', 975: '#0f1010', 990: '#060707',
};

/** Two letters for the placeholder logo: the first letters of the first two words. */
export function brandInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[1]!].map((word) => [...word][0]!) : [...(words[0] ?? '?')].slice(0, 2);
  return letters.join('').toLocaleUpperCase();
}

/** The ready-made colours in Settings → Business (the server's BRAND_PRESETS lists the same). Never amber: that is 4VD's. */
export const BRAND_PRESETS = [
  { key: 'teal', hex: '#0f766e' },
  { key: 'forest', hex: '#2f7d32' },
  { key: 'cobalt', hex: '#1d5fd1' },
  { key: 'plum', hex: '#7c3a8f' },
  { key: 'brick', hex: '#b33a2b' },
  { key: 'navy', hex: '#14284b' },
  { key: 'olive', hex: '#76801f' },
  { key: 'rose', hex: '#d4537e' },
  { key: 'sky', hex: '#7cc4f0' },
] as const;

/** 4VD's own amber: 4VD's business starts on it, and can pick it back. */
export const HOUSE_COLOUR = '#f5b71a';

/** Ready-made accents for charts and the marker: warm and cool picks that sit beside most main colours. */
export const ACCENT_PRESETS = [
  { key: 'saffron', hex: '#e0a33a' },
  { key: 'coral', hex: '#e8664a' },
  { key: 'mint', hex: '#3fbf8f' },
  { key: 'lilac', hex: '#9a7ee0' },
  { key: 'sand', hex: '#c9a77c' },
  { key: 'teal', hex: '#0f766e' },
  { key: 'navy', hex: '#14284b' },
  { key: 'rose', hex: '#d4537e' },
] as const;
