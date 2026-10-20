import { createContext, useContext } from 'react';
import { Platform } from 'react-native';

// Same tokens as the dashboard (admin/src/styles/tokens.css, DESIGN.md "Calm
// Shop"): ink on clean paper, quiet status colours with tints,
// amber for the brand, the main action and where you are.
const light = {
  background: '#edf1f3',
  surface: '#f5f9fb',
  surfaceSunk: '#e1e5e7',
  fill: '#d4d8da',
  ink: '#16191B',
  inkMuted: '#585b5e',
  line: '#e1e5e7',
  lineStrong: '#d4d8da',
  brand: '#745504',
  brandInk: '#ffffff',
  brandSoft: '#feeed2',
  accent: '#a37801',
  warn: '#894529',
  warnSoft: '#feece5',
  danger: '#8d3e47',
  dangerSoft: '#feebeb',
  ok: '#386743',
  okSoft: '#e2f7e5',
  info: '#3e5e7e',
  infoSoft: '#e6f2ff',
  focus: '#745504',
  // Depth: panels rest above the canvas, fields sit into it, buttons stand on
  // a darker edge like a key and press down into it.
  raise: 'inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 0 0 1px rgba(22, 25, 27, 0.09), 0 1px 1px rgba(22, 25, 27, 0.05), 0 2px 4px -1px rgba(22, 25, 27, 0.07)',
  inset: 'inset 0 0 0 1px rgba(22, 25, 27, 0.07), inset 0 1px 2px rgba(22, 25, 27, 0.08)',
  keyDrop: '0 1px 2px rgba(22, 25, 27, 0.12), 0 2px 4px -1px rgba(22, 25, 27, 0.08)',
  keyDropPressed: '0 1px 1px rgba(22, 25, 27, 0.12)',
  keyShine: 'inset 0 1px 0 rgba(255, 255, 255, 0.4)',
  keyShinePaper: 'inset 0 1px 0 rgba(255, 255, 255, 0.9)',
  ctaEdge: '#a37801',
  // Glass (DESIGN.md 8.1): paper at 72% over a blur, a faint top highlight.
  glassBg: 'rgba(245, 249, 251, 0.74)',
  glassHighlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.6)',
};

const dark: typeof light = {
  background: '#0d1012',
  surface: '#16191B',
  surfaceSunk: '#050809',
  fill: '#2b2e30',
  ink: '#f5f9fb',
  inkMuted: '#bbbec0',
  line: '#2b2e30',
  lineStrong: '#424648',
  brand: '#f5b71a',
  brandInk: '#0d1012',
  brandSoft: '#352d1c',
  accent: '#f5b71a',
  warn: '#f8a788',
  warnSoft: '#3c2821',
  danger: '#fda0a7',
  dangerSoft: '#3d2728',
  ok: '#99cda3',
  okSoft: '#253127',
  info: '#9dc2e9',
  infoSoft: '#262f38',
  focus: '#f5b71a',
  raise: 'inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 0 0 1px rgba(255, 255, 255, 0.075), 0 1px 2px rgba(0, 0, 0, 0.5)',
  inset: 'inset 0 0 0 1px rgba(255, 255, 255, 0.05), inset 0 1px 2px rgba(0, 0, 0, 0.6)',
  keyDrop: '0 1px 2px rgba(0, 0, 0, 0.45)',
  keyDropPressed: '0 1px 2px rgba(0, 0, 0, 0.4)',
  keyShine: 'inset 0 1px 0 rgba(255, 255, 255, 0.3)',
  keyShinePaper: 'inset 0 1px 0 rgba(255, 255, 255, 0.12)',
  ctaEdge: '#a37801',
  glassBg: 'rgba(22, 25, 27, 0.74)',
  glassHighlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
};

/** Roles the screens ask for, plus older names they still use. */
function withAliases(palette: typeof light) {
  return {
    ...palette,
    // The main action: solid amber with near-black text, the same in both
    // themes, so the one thing to do on a screen always stands out.
    cta: '#f5b71a',
    ctaInk: '#0d1012',
    // A chosen chip or option: ink too.
    selected: palette.ink,
    onSelected: palette.surface,
    steel: palette.inkMuted,
    signalLow: palette.warn,
    signalLowInk: palette.warn,
    signalOut: palette.danger,
    stockOk: palette.ok,
  };
}

export const palettes = { light: withAliases(light), dark: withAliases(dark) };
export type ThemeColors = (typeof palettes)['light'];

/**
 * A raised button (DESIGN.md 10.1): amber (or paper) on a 2px edge with a soft
 * drop. Pressing sinks the face into the edge; pair with keyTravel.
 */
export function keyShadow(colors: ThemeColors, look: 'clay' | 'paper', pressed: boolean): string {
  const shine = look === 'paper' ? colors.keyShinePaper : colors.keyShine;
  const edge = look === 'paper' ? colors.lineStrong : colors.ctaEdge;
  return `${shine}, 0 ${pressed ? 0 : 2}px 0 ${edge}, ${pressed ? colors.keyDropPressed : colors.keyDrop}`;
}

/** How far a key's face moves down when pressed. */
export function keyTravel(pressed: boolean) {
  return { transform: [{ translateY: pressed ? 2 : 0 }] };
}

// Hanken Grotesk for everything, figures included; the serif (`display`, Source
// Serif 4) only for screen titles and the day's headline on Home, as on the dashboard.
export const fonts = {
  body: 'HankenGrotesk_400Regular',
  bodyMedium: 'HankenGrotesk_500Medium',
  bodyBold: 'HankenGrotesk_600SemiBold',
  display: 'SourceSerif4_500Medium',
  // 700 is only for the 4VD wordmark.
  wordmark: 'HankenGrotesk_700Bold',
  // Small capital labels (dates, kickers), like anthropic.com's spec rows.
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: "ui-monospace, 'SF Mono', Consolas, monospace" }),
};

// The type scale from DESIGN.md section 7: never a raw fontSize number.
// Headline is the display clamp's phone size; inputs stay at 16 so iPhone
// Safari doesn't zoom into a field when it's tapped.
export const type = {
  caption: 12,
  label: 13,
  body: 15,
  input: 16,
  title: 17,
  figure: 28,
  headline: 28,
  display: 32,
  figureLarge: 36,
  hero: 64,
};

// How strongly the woven pillars show behind every screen.
export const texture = { light: 0.035, dark: 0.025 };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { stamp: 3, small: 8, panel: 16, board: 20, pill: 999 };

export type ThemePreference = 'light' | 'dark' | 'system';

/** A saved value, or "system" when it is missing or not one we know. */
export function parsePreference(saved: string | null | undefined): ThemePreference {
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}

export interface ThemeState {
  colors: ThemeColors;
  scheme: 'light' | 'dark';
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeState>({
  colors: palettes.light,
  scheme: 'light',
  preference: 'system',
  setPreference: () => undefined,
});

export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}
