import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNavigationContainerRef, DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
// One file per icon: the package's main entry would bundle all of them.
import { House } from 'phosphor-react-native/src/icons/House';
import { Package } from 'phosphor-react-native/src/icons/Package';
import { Plus } from 'phosphor-react-native/src/icons/Plus';
import { Star } from 'phosphor-react-native/src/icons/Star';
import { User } from 'phosphor-react-native/src/icons/User';
import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Loading } from '../components/ui';
import { AccountScreen } from '../screens/AccountScreen';
import { CarwashScreen } from '../screens/CarwashScreen';
import { CashCountScreen } from '../screens/CashCountScreen';
import { CatalogScreen } from '../screens/CatalogScreen';
import { CountScreen } from '../screens/CountScreen';
import { CountsScreen } from '../screens/CountsScreen';
import { FavoritesScreen } from '../screens/FavoritesScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { MySalesScreen } from '../screens/MySalesScreen';
import { ProductDetailScreen } from '../screens/ProductDetailScreen';
import { RecordSaleScreen } from '../screens/RecordSaleScreen';
import { ScanResultScreen } from '../screens/ScanResultScreen';
import { takePendingScan } from '../utils/scanLinks';
import { TabScreen, TabsScreen } from '../screens/TabsScreen';
import { ReturnScreen } from '../screens/ReturnScreen';
import { ExpiryScreen } from '../screens/ExpiryScreen';
import { WriteOffScreen } from '../screens/WriteOffScreen';
import { canRecordSales, useAuth } from '../state/useAuth';
import { fonts, keyShadow, useTheme, useThemeColors } from '../theme';
import type { MainTabParamList, RootStackParamList } from './types';
import { useT } from '../i18n/useT';

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Opens the product from a scanned QR link, once someone is signed in and the screens are ready. */
function openPendingScan() {
  if (!navigationRef.isReady()) return;
  const code = takePendingScan();
  if (code) navigationRef.navigate('ScanResult', { code });
}
const Tab = createBottomTabNavigator<MainTabParamList>();

type TabIcon = typeof House;

const TAB_BAR_HEIGHT = 64;

/** A tab's icon: filled when it's the current tab, outlined otherwise. */
function tabIcon(Icon: TabIcon) {
  return ({ focused, color }: { focused: boolean; color: string }) => <Icon size={24} color={color} weight={focused ? 'fill' : 'regular'} />;
}

/** Selling is the counter's main job, so its tab is the one orange button in the bar. */
function SellIcon() {
  const colors = useThemeColors();
  return (
    <View style={[styles.sellIcon, { backgroundColor: colors.cta, boxShadow: keyShadow(colors, 'clay', false) }]}>
      <Plus size={20} color={colors.ctaInk} weight="bold" />
    </View>
  );
}

/**
 * The tab bar's frosted pane: a real blur on iPhone and the web. Android's blur
 * needs extra native setup, so there it stays solid paper.
 */
function GlassBar() {
  const { colors, scheme } = useTheme();
  return (
    <View style={StyleSheet.absoluteFill}>
      {Platform.OS !== 'android' && (
        <BlurView
          intensity={40}
          tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
          style={StyleSheet.absoluteFill}
        />
      )}
      {/* Paper over the blur, about 62% opaque, keeps the labels readable on any content. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: Platform.OS === 'android' ? colors.surface : `${colors.surface}9e` }]} />
    </View>
  );
}

function MainTabs() {
  const colors = useThemeColors();
  const t = useT();
  const { state } = useAuth();
  const showSell = state.status === 'signedIn' && canRecordSales(state.user);
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        // Headers sit on the page's own paper, so a screen reads as one printed sheet.
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { fontFamily: fonts.serif, fontSize: 26, color: colors.ink },
        headerShadowVisible: false,
        // Tall enough for a thumb (icon over label), plus the phone's home-bar area.
        // Frosted glass over the page, like the dashboard's top bar: the screen
        // scrolls under it (each tab screen leaves room with TabBarSpacer).
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopColor: colors.line,
          elevation: 0,
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 6,
        },
        tabBarBackground: () => <GlassBar />,
        tabBarLabelStyle: { fontFamily: fonts.bodyBold, fontSize: 12 },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkMuted,
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ headerShown: false, tabBarLabel: t.nav.tabs.home, tabBarIcon: tabIcon(House) }} />
      <Tab.Screen
        name="Catalog"
        component={CatalogScreen}
        options={{ title: t.nav.tabs.products, tabBarLabel: t.nav.tabs.products, tabBarIcon: tabIcon(Package) }}
      />
      <Tab.Screen
        name="Favorites"
        component={FavoritesScreen}
        options={{ title: t.nav.tabs.favorites, tabBarLabel: t.nav.tabs.favorites, tabBarIcon: tabIcon(Star) }}
      />
      {showSell && (
        <Tab.Screen
          name="Sell"
          component={RecordSaleScreen}
          options={{ title: t.nav.recordSale, tabBarLabel: t.nav.tabs.sell, tabBarIcon: () => <SellIcon /> }}
        />
      )}
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        options={{ title: t.nav.tabs.account, tabBarLabel: t.nav.tabs.account, tabBarIcon: tabIcon(User) }}
      />
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

  const signedIn = state.status === 'signedIn';
  useEffect(() => {
    if (signedIn) openPendingScan();
  }, [signedIn]);

  if (state.status === 'loading') return <Loading />;

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme} onReady={() => signedIn && openPendingScan()}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTitleStyle: { fontFamily: fonts.serif, fontSize: 20, color: colors.ink },
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
            <Stack.Screen name="Expiry" component={ExpiryScreen} options={{ title: t.nav.expiry, presentation: 'modal' }} />
            <Stack.Screen name="Counts" component={CountsScreen} options={{ title: t.nav.counts, headerBackTitle: t.nav.back }} />
            <Stack.Screen
              name="Count"
              component={CountScreen}
              options={({ route }) => ({ title: t.nav.counting(route.params.title), headerBackTitle: t.nav.back })}
            />
            <Stack.Screen name="CashCount" component={CashCountScreen} options={{ title: t.nav.cashCount, presentation: 'modal' }} />
            <Stack.Screen name="ScanResult" component={ScanResultScreen} options={{ title: t.scan.title, headerBackTitle: t.nav.back }} />
            <Stack.Screen name="Carwash" component={CarwashScreen} options={{ title: t.nav.carwash, presentation: 'modal' }} />
            <Stack.Screen name="Tabs" component={TabsScreen} options={{ title: t.nav.customerTabs, headerBackTitle: t.nav.back }} />
            <Stack.Screen name="Tab" component={TabScreen} options={({ route }) => ({ title: route.params.name, headerBackTitle: t.nav.back })} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  sellIcon: { width: 44, height: 28, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
});
