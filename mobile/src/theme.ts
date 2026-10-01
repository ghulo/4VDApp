import { useColorScheme } from 'react-native';

// Same identity as the admin dashboard: cool concrete, slate ink, and
// yellow/red reserved for low and sold-out stock.
const light = {
  background: '#eef1f4',
  surface: '#ffffff',
  ink: '#1c2530',
  steel: '#5b6878',
  line: '#d5dbe2',
  lineStrong: '#b9c2cc',
  signalLow: '#f2b705',
  signalLowInk: '#6b5000',
  signalOut: '#c8362b',
  stockOk: '#3d7a5a',
  onInk: '#ffffff',
};

const dark: typeof light = {
  background: '#161c23',
  surface: '#1e262f',
  ink: '#e6ebf0',
  steel: '#9aa6b4',
  line: '#2e3945',
  lineStrong: '#44515f',
  signalLow: '#f2b705',
  signalLowInk: '#f2b705',
  signalOut: '#ef5b4f',
  stockOk: '#6bbf91',
  onInk: '#161c23',
};

export type ThemeColors = typeof light;

export const fonts = {
  body: 'Barlow_400Regular',
  bodyBold: 'Barlow_600SemiBold',
  display: 'BarlowCondensed_600SemiBold',
  displayBold: 'BarlowCondensed_700Bold',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { small: 4, panel: 8 };

export function useThemeColors(): ThemeColors {
  return useColorScheme() === 'dark' ? dark : light;
}
