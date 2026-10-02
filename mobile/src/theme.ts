import { useColorScheme } from 'react-native';

// Same identity as the admin dashboard: shop-floor signage. A slate "board"
// (the same in both themes, like a painted sign) carries the big figures;
// yellow means "look here" (low stock, waiting, where you are), red sold out.
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
  // The slate board: Home's top block, the login screen and the tab bar.
  heroInk: '#1c2530',
  heroRaised: '#263241',
  heroText: '#ffffff',
  heroMuted: '#a9b5c2',
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
  heroInk: '#0f1419',
  heroRaised: '#1c2530',
  heroText: '#ffffff',
  heroMuted: '#a9b5c2',
};

export type ThemeColors = typeof light;

export const fonts = {
  body: 'Barlow_400Regular',
  bodyBold: 'Barlow_600SemiBold',
  display: 'BarlowCondensed_600SemiBold',
  displayBold: 'BarlowCondensed_700Bold',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { small: 6, panel: 10 };

export function useThemeColors(): ThemeColors {
  return useColorScheme() === 'dark' ? dark : light;
}
