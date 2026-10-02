import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PushSettingsPanel } from '../components/PushSettingsPanel';
import { Button } from '../components/ui';
import { API_URL } from '../services/apiClient';
import { useAuth, useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, useThemeColors } from '../theme';

const ROLE_DESCRIPTION = {
  admin: 'Admin. Manage everything from the admin dashboard.',
  employee: 'Employee. You can browse products and record sales.',
  family: 'Family. You can browse products and save favorites.',
} as const;

export function AccountScreen() {
  const colors = useThemeColors();
  const user = useCurrentUser();
  const { logout } = useAuth();

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.name, { color: colors.ink }]}>{user.name}</Text>
        <Text style={[styles.detail, { color: colors.steel }]}>{user.email}</Text>
        <Text style={[styles.detail, { color: colors.ink }]}>{ROLE_DESCRIPTION[user.role]}</Text>
      </View>
      <PushSettingsPanel />
      <Button label="Log out" variant="quiet" onPress={logout} />
      <Text style={[styles.footnote, { color: colors.steel }]}>Connected to {API_URL}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  panel: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1, gap: spacing.xs },
  name: { fontFamily: fonts.displayBold, fontSize: 28 },
  detail: { fontFamily: fonts.body, fontSize: 16 },
  footnote: { fontFamily: fonts.body, fontSize: 13, textAlign: 'center' },
});
