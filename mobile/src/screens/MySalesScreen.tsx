import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { MY_SALES_QUERY_KEY, MySales } from '../components/MySales';
import { spacing, useThemeColors } from '../theme';

export function MySalesScreen() {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function refresh() {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: MY_SALES_QUERY_KEY });
    setIsRefreshing(false);
  }

  return (
    <ScrollView
     
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
    >
      <MySales />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg },
});
