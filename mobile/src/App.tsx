import { Barlow_400Regular, Barlow_600SemiBold } from '@expo-google-fonts/barlow';
import { BarlowCondensed_600SemiBold, BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from './components/ui';
import { RootNavigator } from './navigation/RootNavigator';
import { useThemeColors } from './theme';
import { ApiError } from './services/apiClient';
import { AuthProvider } from './state/AuthProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retrying a 404 or a permission error won't change the answer.
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

/**
 * In a laptop browser, keep the app phone-width and centred instead of
 * stretching across the whole window. Phones are unaffected.
 */
const styles = StyleSheet.create({
  page: { flex: 1 },
  column: Platform.OS === 'web' ? { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center' } : { flex: 1 },
});

export default function App() {
  const colors = useThemeColors();
  const [fontsLoaded] = useFonts({
    Barlow_400Regular,
    Barlow_600SemiBold,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
  });

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        {/* The page colour fills the browser window around the phone-width column. */}
        <View style={[styles.page, { backgroundColor: colors.background }]}>
          <View style={styles.column}>
            <AuthProvider>{fontsLoaded ? <RootNavigator /> : <Loading />}</AuthProvider>
          </View>
        </View>
      </QueryClientProvider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
