import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, View } from 'react-native';
import { Loading } from '../components/ui';
import { AccountScreen } from '../screens/AccountScreen';
import { CatalogScreen } from '../screens/CatalogScreen';
import { CountScreen } from '../screens/CountScreen';
import { CountsScreen } from '../screens/CountsScreen';
import { FavoritesScreen } from '../screens/FavoritesScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { MySalesScreen } from '../screens/MySalesScreen';
import { ProductDetailScreen } from '../screens/ProductDetailScreen';
import { RecordSaleScreen } from '../screens/RecordSaleScreen';
import { ReturnScreen } from '../screens/ReturnScreen';
import { WriteOffScreen } from '../screens/WriteOffScreen';
import { canRecordSales, useAuth } from '../state/useAuth';
import { fonts, useTheme, useThemeColors } from '../theme';
import type { MainTabParamList, RootStackParamList } from './types';
import { useT } from '../i18n/useT';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

/** Text-only tab labels: plain words read better than a row of generic icons. */
/** The current tab gets the brand colour and a small brass dot above it. */
function tabLabel(label: string, dotColor: string) {
  return ({ focused, color }: { focused: boolean; color: string }) => (
    <View style={{ alignItems: 'center', gap: 5 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: focused ? dotColor : 'transparent' }} />
      <Text style={{ color, fontFamily: focused ? fonts.display : fonts.bodyBold, fontSize: 14 }}>{label}</Text>
    </View>
  );
}

function MainTabs() {
  const colors = useThemeColors();
  const t = useT();
  const { state } = useAuth();
  const showSell = state.status === 'signedIn' && canRecordSales(state.user);

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.ink },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 64 },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarIcon: () => null,
        tabBarIconStyle: { display: 'none' },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ headerShown: false, tabBarLabel: tabLabel(t.nav.tabs.home, colors.brass) }} />
      <Tab.Screen name="Catalog" component={CatalogScreen} options={{ title: t.nav.tabs.products, tabBarLabel: tabLabel(t.nav.tabs.products, colors.brass) }} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} options={{ title: t.nav.tabs.favorites, tabBarLabel: tabLabel(t.nav.tabs.favorites, colors.brass) }} />
      {showSell && (
        <Tab.Screen
          name="Sell"
          component={RecordSaleScreen}
          options={{ title: t.nav.recordSale, tabBarLabel: tabLabel(t.nav.tabs.sell, colors.brass) }}
        />
      )}
      <Tab.Screen name="Account" component={AccountScreen} options={{ title: t.nav.tabs.account, tabBarLabel: tabLabel(t.nav.tabs.account, colors.brass) }} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { state } = useAuth();
  const { colors, scheme } = useTheme();
  const t = useT();

  const baseTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme: Theme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: colors.background,
      card: colors.surface,
      text: colors.ink,
      border: colors.line,
      primary: colors.brand,
    },
  };

  if (state.status === 'loading') return <Loading />;

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { fontFamily: fonts.display, color: colors.ink },
          headerTintColor: colors.ink,
          headerShadowVisible: false,
        }}
      >
        {state.status === 'signedOut' ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen
              name="ProductDetail"
              component={ProductDetailScreen}
              options={({ route }) => ({ title: route.params.name, headerBackTitle: t.nav.back })}
            />
            <Stack.Screen
              name="RecordSale"
              component={RecordSaleScreen}
              options={{ title: t.nav.recordSale, presentation: 'modal' }}
            />
            <Stack.Screen name="MySales" component={MySalesScreen} options={{ title: t.nav.mySales, headerBackTitle: t.nav.back }} />
            <Stack.Screen name="Return" component={ReturnScreen} options={{ title: t.nav.returnSale, presentation: 'modal' }} />
            <Stack.Screen
              name="WriteOff"
              component={WriteOffScreen}
              options={{ title: t.nav.writeOff, presentation: 'modal' }}
            />
            <Stack.Screen name="Counts" component={CountsScreen} options={{ title: t.nav.counts, headerBackTitle: t.nav.back }} />
            <Stack.Screen
              name="Count"
              component={CountScreen}
              options={({ route }) => ({ title: t.nav.counting(route.params.title), headerBackTitle: t.nav.back })}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
