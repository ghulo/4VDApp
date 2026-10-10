import { ErrorBoundary } from './components/ErrorBoundary';
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from '@expo-google-fonts/hanken-grotesk';
// Only the one serif weight in use, so the other weights' files aren't bundled.
import { SourceSerif4_500Medium } from '@expo-google-fonts/source-serif-4/500Medium';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from './components/ui';
import { RootNavigator } from './navigation/RootNavigator';
import { useTheme } from './theme';
import { ApiError } from './services/apiClient';
import { AuthProvider } from './state/AuthProvider';
import { ThemeProvider } from './state/ThemeProvider';
import { I18nProvider } from './i18n/I18nProvider';

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
  return (
    <I18nProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <Shell />
        </ErrorBoundary>
      </ThemeProvider>
    </I18nProvider>
  );
}

function Shell() {
  const { colors, scheme } = useTheme();
  const [fontsLoaded] = useFonts({
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
    SourceSerif4_500Medium,
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
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaProvider>
  );
}
