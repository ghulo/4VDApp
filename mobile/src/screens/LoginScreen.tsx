import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, TextField } from '../components/ui';
import { useAuth } from '../state/useAuth';
import { LogoMark } from '../components/LogoMark';
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
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.heroInk }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brandRow}>
            <LogoMark size={52} />
            <Text style={styles.brand}>4VD</Text>
          </View>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.title, { color: colors.ink }]}>Log in</Text>
            <Text style={[styles.subtitle, { color: colors.inkMuted }]}>Use the email your account was set up with.</Text>

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
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  brand: { fontFamily: fonts.display, fontSize: 40, letterSpacing: -1, color: '#ffffff' },
  card: { padding: spacing.xl, borderRadius: radius.board },
  title: { fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.5 },
  subtitle: { fontFamily: fonts.body, fontSize: 15, marginTop: spacing.xs, marginBottom: spacing.xl },
  error: { fontFamily: fonts.bodyBold, fontSize: 15, marginBottom: spacing.md },
});
