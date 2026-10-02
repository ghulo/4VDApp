import { createContext, useContext } from 'react';

// Same identity as the dashboard (brand/README.md): pine green and brass on
// cool, slightly green neutrals. The deep-pine board carries the big figures.
const light = {
  background: '#f3f5f2',
  surface: '#ffffff',
  surfaceSunk: '#e9ede8',
  ink: '#122019',
  inkMuted: '#55665d',
  line: '#d9e0da',
  lineStrong: '#bfcac2',
  brand: '#1d5c45',
  brandInk: '#ffffff',
  brandSoft: '#e1eee7',
  brandDeep: '#123b2d',
  brass: '#b8862b',
  warn: '#b36b00',
  danger: '#b83a2b',
  ok: '#2f7d55',
};

const dark: typeof light = {
  background: '#0d1411',
  surface: '#151f1a',
  surfaceSunk: '#0a100d',
  ink: '#e6eee9',
  inkMuted: '#97a89f',
  line: '#26332c',
  lineStrong: '#3a4a41',
  brand: '#5bbf92',
  brandInk: '#08130e',
  brandSoft: '#18352a',
  brandDeep: '#163d2e',
  brass: '#d9a945',
  warn: '#f0a73a',
  danger: '#f07563',
  ok: '#6cc795',
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
    // The deep-pine board: white text on it in both themes.
    heroInk: palette.brandDeep,
    heroRaised: palette === light ? '#1e5240' : '#21503d',
    heroText: '#ffffff',
    heroMuted: '#b9cfc4',
  };
}

export const palettes = { light: withAliases(light), dark: withAliases(dark) };
export type ThemeColors = (typeof palettes)['light'];

export const fonts = {
  body: 'HankenGrotesk_400Regular',
  bodyBold: 'HankenGrotesk_600SemiBold',
  display: 'HankenGrotesk_800ExtraBold',
  displayBold: 'HankenGrotesk_800ExtraBold',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { small: 8, panel: 14, board: 20 };

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
