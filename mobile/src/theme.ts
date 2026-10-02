import { createContext, useContext } from 'react';

// Same tokens as the dashboard (admin/src/styles/tokens.css), after Cloudflare's
// look: warm neutrals, one orange accent, quiet status colours with tints. The
// orange board on Home carries the big figures in near-black.
const light = {
  background: '#faf9f7',
  surface: '#ffffff',
  surfaceSunk: '#f4f2ef',
  fill: '#efece8',
  ink: '#1f1b19',
  inkMuted: '#6b635f',
  line: '#ebe7e3',
  lineStrong: '#d9d3ce',
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

/** Older names the screens still use; they follow the new colours. */
function withAliases(palette: typeof light) {
  return {
    ...palette,
    steel: palette.inkMuted,
    signalLow: palette.warn,
    signalLowInk: palette.warn,
    signalOut: palette.danger,
    stockOk: palette.ok,
    onInk: palette.brandInk,
    // Older name for the accent dot under the current tab.
    brass: palette.accent,
    // The orange board: near-black text on it in both themes (4.5:1 or more).
    heroInk: palette.accent,
    heroRaised: 'rgba(255, 251, 245, 0.4)',
    heroText: '#1c0f08',
    heroMuted: '#3f1d0f',
  };
}

export const palettes = { light: withAliases(light), dark: withAliases(dark) };
export type ThemeColors = (typeof palettes)['light'];

// Medium-weight headings with tight tracking, like Cloudflare; never heavy.
export const fonts = {
  body: 'HankenGrotesk_400Regular',
  bodyMedium: 'HankenGrotesk_500Medium',
  bodyBold: 'HankenGrotesk_600SemiBold',
  display: 'HankenGrotesk_600SemiBold',
  displayBold: 'HankenGrotesk_700Bold',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { small: 8, panel: 12, board: 16 };

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
