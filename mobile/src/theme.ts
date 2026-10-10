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
  warn: '#86500c',
  warnSoft: '#f6ecd9',
  danger: '#b0302a',
  dangerSoft: '#f8e5e1',
  ok: '#2f6b3f',
  okSoft: '#e7efe3',
  info: '#3d5670',
  infoSoft: '#e6ebf0',
  focus: '#141413',
  // Depth: panels rest above the canvas, fields sit into it, buttons stand on
  // a darker edge like a key and press down into it.
  raise: 'inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 0 0 1px rgba(20, 20, 19, 0.04), 0 1px 2px rgba(20, 20, 19, 0.06), 0 4px 14px rgba(20, 20, 19, 0.06)',
  inset: 'inset 0 1px 2px rgba(20, 20, 19, 0.08)',
  keyDrop: '0 2px 6px rgba(20, 20, 19, 0.1)',
  keyDropPressed: '0 1px 2px rgba(20, 20, 19, 0.12)',
  keyShine: 'inset 0 1px 0 rgba(255, 255, 255, 0.4)',
  keyShinePaper: 'inset 0 1px 0 rgba(255, 255, 255, 0.9)',
  ctaEdge: '#a8482a',
  // Glass (DESIGN.md 8.1): paper at 72% over a blur, a faint top highlight.
  glassBg: 'rgba(250, 249, 245, 0.72)',
  glassHighlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.6)',
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
  warn: '#e0a85a',
  warnSoft: '#3a2e19',
  danger: '#f39a8f',
  dangerSoft: '#3d201c',
  ok: '#86c08f',
  okSoft: '#1f3022',
  info: '#9fb4cc',
  infoSoft: '#222b35',
  focus: '#faf9f5',
  raise: 'inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 0 0 1px rgba(255, 255, 255, 0.05), 0 1px 2px rgba(0, 0, 0, 0.3), 0 6px 18px rgba(0, 0, 0, 0.28)',
  inset: 'inset 0 1px 3px rgba(0, 0, 0, 0.45)',
  keyDrop: '0 2px 6px rgba(0, 0, 0, 0.35)',
  keyDropPressed: '0 1px 2px rgba(0, 0, 0, 0.4)',
  keyShine: 'inset 0 1px 0 rgba(255, 255, 255, 0.3)',
  keyShinePaper: 'inset 0 1px 0 rgba(255, 255, 255, 0.07)',
  ctaEdge: '#9a4024',
  glassBg: 'rgba(38, 38, 36, 0.72)',
  glassHighlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
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
 * A raised button (DESIGN.md 10.1): clay (or paper) on a 2px edge with a soft
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

export const spacing ={ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
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
