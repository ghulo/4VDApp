import { createContext, useContext } from 'react';
import { Platform } from 'react-native';

// Same tokens as the dashboard (admin/src/styles/tokens.css, DESIGN.md "Calm
// Shop"): ink on ivory paper with oat panels, quiet status colours with tints,
// solid ink for the main action and clay for the brand and where you are.
const light = {
  background: '#f0eee6',
  surface: '#faf9f5',
  surfaceSunk: '#e8e4da',
  fill: '#e3dacc',
  ink: '#141413',
  inkMuted: '#5e5d59',
  line: '#e0dbcf',
  lineStrong: '#cbc3b3',
  brand: '#a8482a',
  brandInk: '#ffffff',
  brandSoft: '#f5e6dc',
  accent: '#d97757',
  warn: '#b45309',
  warnSoft: '#fef3e2',
  danger: '#b91c1c',
  dangerSoft: '#fdecec',
  ok: '#047857',
  okSoft: '#e6f5ee',
};

const dark: typeof light = {
  background: '#1f1e1d',
  surface: '#262624',
  surfaceSunk: '#1a1918',
  fill: '#30302e',
  ink: '#faf9f5',
  inkMuted: '#a6a39b',
  line: '#2f2e2b',
  lineStrong: '#3e3d39',
  brand: '#e08a6b',
  brandInk: '#1a120e',
  brandSoft: '#3a2219',
  accent: '#d97757',
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
    // The main action: solid ink with paper text, as on anthropic.com. Clay is
    // the brand's colour (logo, illustrations, where you are), not a button.
    cta: palette.ink,
    ctaInk: palette.surface,
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

// Hanken Grotesk for everything, figures included; the serif (Source Serif 4)
// only for screen titles and the day's headline on Home, as on the dashboard.
export const fonts = {
  body: 'HankenGrotesk_400Regular',
  bodyMedium: 'HankenGrotesk_500Medium',
  bodyBold: 'HankenGrotesk_600SemiBold',
  display: 'HankenGrotesk_600SemiBold',
  displayBold: 'HankenGrotesk_700Bold',
  serif: 'SourceSerif4_500Medium',
  // Small capital labels (dates, kickers), like anthropic.com's spec rows.
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: "ui-monospace, 'SF Mono', Consolas, monospace" }),
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { small: 8, panel: 16, board: 20 };

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
