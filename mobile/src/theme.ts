import { createContext, useContext } from 'react';
import { Platform } from 'react-native';

// Same tokens as the dashboard (admin/src/styles/tokens.css, DESIGN.md "Calm
// Shop"): ink on ivory paper with oat panels, quiet status colours with tints,
// clay for the brand, the main action and where you are.
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
  accent: '#d4704f',
  warn: '#b45309',
  warnSoft: '#fef3e2',
  danger: '#b91c1c',
  dangerSoft: '#fdecec',
  ok: '#047857',
  okSoft: '#e6f5ee',
  // Depth: panels rest above the canvas, fields sit into it, buttons stand on
  // a darker edge like a key and press down into it.
  raise: '0 0 0 1px rgba(20, 20, 19, 0.04), 0 1px 2px rgba(20, 20, 19, 0.06), 0 4px 14px rgba(20, 20, 19, 0.06)',
  inset: 'inset 0 1px 2px rgba(20, 20, 19, 0.08)',
  keyDrop: '0 4px 10px rgba(20, 20, 19, 0.14)',
  keyDropPressed: '0 1px 2px rgba(20, 20, 19, 0.12)',
  keyShine: 'inset 0 1px 0 rgba(255, 255, 255, 0.4)',
  keyShinePaper: 'inset 0 1px 0 rgba(255, 255, 255, 0.9)',
  ctaEdge: '#a8482a',
};

const dark: typeof light = {
  background: '#191817',
  surface: '#262624',
  surfaceSunk: '#151413',
  fill: '#30302e',
  ink: '#faf9f5',
  inkMuted: '#a6a39b',
  line: '#2f2e2b',
  lineStrong: '#3e3d39',
  brand: '#e08a6b',
  brandInk: '#1a120e',
  brandSoft: '#3a2219',
  accent: '#d4704f',
  warn: '#fbbf24',
  warnSoft: '#3a2c0d',
  danger: '#f87171',
  dangerSoft: '#3b1717',
  ok: '#34d399',
  okSoft: '#0f3326',
  raise: '0 0 0 1px rgba(255, 255, 255, 0.05), 0 1px 2px rgba(0, 0, 0, 0.3), 0 6px 18px rgba(0, 0, 0, 0.28)',
  inset: 'inset 0 1px 3px rgba(0, 0, 0, 0.45)',
  keyDrop: '0 4px 12px rgba(0, 0, 0, 0.45)',
  keyDropPressed: '0 1px 2px rgba(0, 0, 0, 0.4)',
  keyShine: 'inset 0 1px 0 rgba(255, 255, 255, 0.3)',
  keyShinePaper: 'inset 0 1px 0 rgba(255, 255, 255, 0.07)',
  ctaEdge: '#9a4024',
};

/** Roles the screens ask for, plus older names they still use. */
function withAliases(palette: typeof light) {
  return {
    ...palette,
    // The main action: solid clay with near-black text, the same in both
    // themes, so the one thing to do on a screen always stands out.
    cta: '#d4704f',
    ctaInk: '#1c0f08',
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
 * A raised button: clay (or paper) on a darker edge that it presses into.
 * Pair with keyTravel so the face moves down as the edge shrinks.
 */
export function keyShadow(colors: ThemeColors, look: 'clay' | 'paper', pressed: boolean): string {
  if (look === 'paper') {
    return `${colors.keyShinePaper}, 0 ${pressed ? 0 : 2}px 0 ${colors.lineStrong}`;
  }
  return `${colors.keyShine}, 0 ${pressed ? 1 : 3}px 0 ${colors.ctaEdge}, ${pressed ? colors.keyDropPressed : colors.keyDrop}`;
}

/** How far a key's face moves down when pressed. */
export function keyTravel(pressed: boolean) {
  return { transform: [{ translateY: pressed ? 2 : 0 }] };
}

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
