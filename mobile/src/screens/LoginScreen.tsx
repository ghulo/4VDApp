import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, TextField } from '../components/ui';
import { useAuth } from '../state/useAuth';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage } from '../utils/format';

export function LoginScreen() {
  const colors = useThemeColors();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin() {
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (loginError) {
      setError(errorMessage(loginError));
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.ink }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.card, { backgroundColor: colors.surface, borderTopColor: colors.signalLow }]}>
            <Text style={[styles.brand, { color: colors.ink }]}>4VD</Text>
            <Text style={[styles.subtitle, { color: colors.steel }]}>See what's in stock and what it costs</Text>

            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={handleLogin}
            />

            {error && (
              <Text style={[styles.error, { color: colors.signalOut }]} accessibilityRole="alert">
                {error}
              </Text>
            )}

            <Button label="Log in" onPress={handleLogin} loading={isSubmitting} disabled={!email || !password} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  card: { padding: spacing.xl, borderRadius: radius.panel, borderTopWidth: 6 },
  brand: { fontFamily: fonts.displayBold, fontSize: 56, lineHeight: 58 },
  subtitle: { fontFamily: fonts.body, fontSize: 16, marginTop: spacing.xs, marginBottom: spacing.xl },
  error: { fontFamily: fonts.bodyBold, fontSize: 15, marginBottom: spacing.md },
});
