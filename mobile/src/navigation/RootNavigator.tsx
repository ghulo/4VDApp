import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, useColorScheme, View } from 'react-native';
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
import { fonts, useThemeColors } from '../theme';
import type { MainTabParamList, RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

/** Text-only tab labels: plain words read better than a row of generic icons. */
/** Condensed sign lettering, with a yellow bar over the tab you're on. */
function tabLabel(label: string) {
  return ({ focused, color }: { focused: boolean; color: string }) => (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ width: 28, height: 3, borderRadius: 2, backgroundColor: focused ? '#f2b705' : 'transparent' }} />
      <Text style={{ color, fontFamily: fonts.displayBold, fontSize: 17 }}>{label}</Text>
    </View>
  );
}

function MainTabs() {
  const colors = useThemeColors();
  const { state } = useAuth();
  const showSell = state.status === 'signedIn' && canRecordSales(state.user);

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { fontFamily: fonts.displayBold, fontSize: 24, color: colors.ink },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.heroInk, borderTopColor: colors.heroInk, height: 64 },
        tabBarActiveTintColor: colors.heroText,
        tabBarInactiveTintColor: colors.heroMuted,
        tabBarIcon: () => null,
        tabBarIconStyle: { display: 'none' },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ headerShown: false, tabBarLabel: tabLabel('Home') }} />
      <Tab.Screen name="Catalog" component={CatalogScreen} options={{ title: 'Products', tabBarLabel: tabLabel('Products') }} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} options={{ tabBarLabel: tabLabel('Favorites') }} />
      {showSell && (
        <Tab.Screen
          name="Sell"
          component={RecordSaleScreen}
          options={{ title: 'Record a sale', tabBarLabel: tabLabel('Sell') }}
        />
      )}
      <Tab.Screen name="Account" component={AccountScreen} options={{ tabBarLabel: tabLabel('Account') }} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { state } = useAuth();
  const colors = useThemeColors();
  const scheme = useColorScheme();

  const baseTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme: Theme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: colors.background,
      card: colors.surface,
      text: colors.ink,
      border: colors.line,
      primary: colors.ink,
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
              options={({ route }) => ({ title: route.params.name, headerBackTitle: 'Back' })}
            />
            <Stack.Screen
              name="RecordSale"
              component={RecordSaleScreen}
              options={{ title: 'Record a sale', presentation: 'modal' }}
            />
            <Stack.Screen name="MySales" component={MySalesScreen} options={{ title: 'My sales', headerBackTitle: 'Back' }} />
            <Stack.Screen name="Return" component={ReturnScreen} options={{ title: 'Return a sale', presentation: 'modal' }} />
            <Stack.Screen
              name="WriteOff"
              component={WriteOffScreen}
              options={{ title: 'Report damage or loss', presentation: 'modal' }}
            />
            <Stack.Screen name="Counts" component={CountsScreen} options={{ title: 'Stock counts', headerBackTitle: 'Back' }} />
            <Stack.Screen
              name="Count"
              component={CountScreen}
              options={({ route }) => ({ title: `Counting ${route.params.title.toLowerCase()}`, headerBackTitle: 'Back' })}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
