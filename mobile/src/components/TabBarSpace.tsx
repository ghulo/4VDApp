import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useContext } from 'react';
import { View } from 'react-native';

/** How tall the see-through tab bar over this screen is, or 0 when the screen isn't a tab. */
export function useTabBarSpace(): number {
  return useContext(BottomTabBarHeightContext) ?? 0;
}

/** Room at the end of a scrolling screen so its last row clears the glass tab bar. */
export function TabBarSpacer() {
  const height = useTabBarSpace();
  return height > 0 ? <View style={{ height }} /> : null;
}
