import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiStatus } from '../components/ApiStatus';

const THEMES = {
  light: { background: '#f5f6f8', text: '#1b1f24', muted: '#5f6b7a' },
  dark: { background: '#111418', text: '#e8ebef', muted: '#9aa5b1' },
};

export function HomeScreen() {
  const theme = THEMES[useColorScheme() === 'dark' ? 'dark' : 'light'];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>4VD App</Text>
        <Text style={[styles.subtitle, { color: theme.muted }]}>
          Product catalog, stock and pricing are coming next.
        </Text>
        <ApiStatus textColor={theme.muted} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 12,
  },
});
