import { createContext, useContext } from 'react';

// Same tokens as the dashboard (admin/src/styles/tokens.css, DESIGN.md "Calm
// Shop"): ink on ivory paper, quiet status colours with tints, and orange only
// for the main action (with near-black text on it) and where you are.
const light = {
  background: '#f5f2ea',
  surface: '#fefdfa',
  surfaceSunk: '#eeeae0',
  fill: '#e8e3d7',
  ink: '#1f1b19',
  inkMuted: '#645d57',
  line: '#e4ded2',
  lineStrong: '#cec6b7',
  brand: '#c2410c',
  brandInk: '#ffffff',
  brandSoft: '#fff4ed',
  accent: '#ff5e1f',
  warn: '#b45309',
  warnSoft: '#fef3e2',
  danger: '#b91c1c',
  dangerSoft: '#fdecec',
  ok: '#047857',
  okSoft: '#e6f5ee',
};

const dark: typeof light = {
  background: '#151414',
  surface: '#1c1b1a',
  surfaceSunk: '#111010',
  fill: '#262422',
  ink: '#f2ebe7',
  inkMuted: '#9a9390',
  line: '#2c2927',
  lineStrong: '#3d3936',
  brand: '#ff7038',
  brandInk: '#1a120e',
  brandSoft: '#3a1f12',
  accent: '#ff5e1f',
  warn: '#fbbf24',
  warnSoft: '#3a2c0d',
  danger: '#f87171',
  dangerSoft: '#3b1717',
  ok: '#34d399',
  okSoft: '#0f3326',
};

/** Roles the screens ask for, plus older names they still use. */
function withAliases(palette: typeof light) {
  return {
    ...palette,
    // The main action: Signal Orange with near-black text (white fails contrast).
    cta: palette.accent,
    ctaInk: '#1c0f08',
    // A chosen chip or option: ink, so orange keeps meaning "act here".
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

// Hanken Grotesk for everything, figures included; the serif (Source Serif 4)
// only for screen titles and the day's headline on Home, as on the dashboard.
export const fonts = {
  body: 'HankenGrotesk_400Regular',
  bodyMedium: 'HankenGrotesk_500Medium',
  bodyBold: 'HankenGrotesk_600SemiBold',
  display: 'HankenGrotesk_600SemiBold',
  displayBold: 'HankenGrotesk_700Bold',
  serif: 'SourceSerif4_500Medium',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { small: 6, panel: 8, board: 10 };

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
