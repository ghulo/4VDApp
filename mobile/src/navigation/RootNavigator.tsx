import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, useColorScheme } from 'react-native';
import { Loading } from '../components/ui';
import { AccountScreen } from '../screens/AccountScreen';
import { CatalogScreen } from '../screens/CatalogScreen';
import { FavoritesScreen } from '../screens/FavoritesScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { ProductDetailScreen } from '../screens/ProductDetailScreen';
import { RecordSaleScreen } from '../screens/RecordSaleScreen';
import { canRecordSales, useAuth } from '../state/useAuth';
import { fonts, useThemeColors } from '../theme';
import type { MainTabParamList, RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

/** Text-only tab labels: plain words read better than a row of generic icons. */
function tabLabel(label: string) {
  return ({ focused, color }: { focused: boolean; color: string }) => (
    <Text style={{ color, fontFamily: focused ? fonts.bodyBold : fonts.body, fontSize: 14 }}>{label}</Text>
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
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.steel,
        tabBarIcon: () => null,
        tabBarIconStyle: { display: 'none' },
      }}
    >
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
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
