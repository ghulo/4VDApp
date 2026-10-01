import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MY_SALES_QUERY_KEY, MySales } from '../components/MySales';
import { Button } from '../components/ui';
import { API_URL } from '../services/apiClient';
import { canRecordSales, useAuth, useCurrentUser } from '../state/useAuth';
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
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const showSales = canRecordSales(user);

  async function refresh() {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: MY_SALES_QUERY_KEY });
    setIsRefreshing(false);
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={showSales ? <RefreshControl refreshing={isRefreshing} onRefresh={refresh} /> : undefined}
    >
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.name, { color: colors.ink }]}>{user.name}</Text>
        <Text style={[styles.detail, { color: colors.steel }]}>{user.email}</Text>
        <Text style={[styles.detail, { color: colors.ink }]}>{ROLE_DESCRIPTION[user.role]}</Text>
      </View>
      {showSales && <MySales />}
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
