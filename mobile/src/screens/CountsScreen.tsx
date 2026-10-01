import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChoiceRow } from '../components/inputs';
import { Button, ErrorState, Loading } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { categoriesApi, countsApi } from '../services/api';
import type { StockCountSummary } from '../services/types';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Counts'>;

export const COUNTS_QUERY_KEY = ['stock-counts'];

const scopeName = (count: StockCountSummary) => count.category?.name ?? 'Whole shop';

export function CountsScreen({ navigation }: Props) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const counts = useQuery({ queryKey: COUNTS_QUERY_KEY, queryFn: countsApi.list });
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const [scope, setScope] = useState('all');

  const start = useMutation({
    mutationFn: () => countsApi.start(scope === 'all' ? null : Number(scope)),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: COUNTS_QUERY_KEY });
      navigation.navigate('Count', { countId: count.id, title: scopeName(count) });
    },
  });

  if (counts.isPending) return <Loading />;
  if (counts.isError) return <ErrorState error={counts.error} onRetry={() => counts.refetch()} />;

  const open = counts.data.filter((count) => count.status === 'open');
  const waiting = counts.data.filter((count) => count.status === 'submitted');
  const scopeOptions = [
    { value: 'all', label: 'Whole shop' },
    ...(categories.data ?? []).map((category) => ({ value: String(category.id), label: category.name })),
  ];

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.intro, { color: colors.steel }]}>
        Count what is on the shelf. The owner reviews anything that differs from the system.
      </Text>

      {open.length > 0 && (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Text style={[styles.panelTitle, { color: colors.ink }]} accessibilityRole="header">
            Carry on counting
          </Text>
          {open.map((count) => (
            <Pressable
              key={count.id}
              accessibilityRole="button"
              onPress={() => navigation.navigate('Count', { countId: count.id, title: scopeName(count) })}
              style={({ pressed }) => [styles.row, { borderTopColor: colors.line }, pressed && styles.pressed]}
            >
              <Text style={[styles.rowName, { color: colors.ink }]}>{scopeName(count)}</Text>
              <Text style={[styles.rowMeta, { color: colors.steel }]}>Started by {count.startedBy?.name ?? 'someone'}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {waiting.length > 0 && (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Text style={[styles.panelTitle, { color: colors.ink }]} accessibilityRole="header">
            Waiting for the owner
          </Text>
          {waiting.map((count) => (
            <View key={count.id} style={[styles.row, { borderTopColor: colors.line }]}>
              <Text style={[styles.rowName, { color: colors.ink }]}>{scopeName(count)}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.panelTitle, { color: colors.ink }]} accessibilityRole="header">
          Start a count
        </Text>
        <ChoiceRow label="What to count" options={scopeOptions} value={scope} onChange={setScope} />
        {start.isError && <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(start.error)}</Text>}
        <Button label="Start counting" onPress={() => start.mutate()} loading={start.isPending} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  intro: { fontFamily: fonts.body, fontSize: 15 },
  panel: { borderWidth: 1, borderRadius: radius.panel, padding: spacing.lg, gap: spacing.sm },
  panelTitle: { fontFamily: fonts.displayBold, fontSize: 20 },
  row: { minHeight: 52, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  rowName: { fontFamily: fonts.bodyBold, fontSize: 16 },
  rowMeta: { fontFamily: fonts.body, fontSize: 14 },
  pressed: { opacity: 0.7 },
  error: { fontFamily: fonts.body, fontSize: 15 },
});
