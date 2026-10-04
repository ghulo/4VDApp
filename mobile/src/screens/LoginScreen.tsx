import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, TextField } from '../components/ui';
import { useAuth } from '../state/useAuth';
import { LogoMark } from '../components/LogoMark';
import { ShopSunrise } from '../components/print';
import { DASHBOARD_URL } from '../services/apiClient';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage } from '../utils/format';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { useT } from '../i18n/useT';

export function LoginScreen() {
  const colors = useThemeColors();
  const t = useT();
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
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brandRow}>
            <LogoMark size={52} />
            <Text style={[styles.brand, { color: colors.ink }]}>4VD</Text>
          </View>
          <View style={styles.art}>
            <ShopSunrise />
          </View>
          <View style={[styles.card, { backgroundColor: colors.surface, boxShadow: colors.raise }]}>
            <Text style={[styles.title, { color: colors.ink }]}>{t.login.title}</Text>
            <Text style={[styles.subtitle, { color: colors.inkMuted }]}>{t.login.subtitle}</Text>

            <TextField
              label={t.login.email}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
            />
            <TextField
              label={t.login.password}
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

            <Button label={t.login.logIn} onPress={handleLogin} loading={isSubmitting} disabled={!email || !password} />
            <Pressable
              accessibilityRole="link"
              onPress={() => Linking.openURL(`${DASHBOARD_URL}/forgot-password`)}
              hitSlop={8}
              style={styles.forgot}
            >
              <Text style={[styles.forgotText, { color: colors.ink }]}>{t.login.forgot}</Text>
            </Pressable>
            <View style={styles.language}>
              <LanguageSwitch />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  art: { marginBottom: spacing.lg },
  brand: { fontFamily: fonts.displayBold, fontSize: 40, letterSpacing: -1.5 },
  card: { padding: spacing.xl, borderRadius: radius.board },
  title: { fontFamily: fonts.serif, fontSize: 30 },
  subtitle: { fontFamily: fonts.body, fontSize: 15, marginTop: spacing.xs, marginBottom: spacing.xl },
  forgot: { marginTop: spacing.lg, alignSelf: 'center' },
  language: { marginTop: spacing.xl },
  forgotText: { fontFamily: fonts.bodyBold, fontSize: 15, textDecorationLine: 'underline' },
  error: { fontFamily: fonts.bodyBold, fontSize: 15, marginBottom: spacing.md },
});
