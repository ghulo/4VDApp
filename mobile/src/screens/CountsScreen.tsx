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
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';

type Props = NativeStackScreenProps<RootStackParamList, 'Counts'>;

export const COUNTS_QUERY_KEY = ['stock-counts'];

const scopeName = (t: Catalogue, count: StockCountSummary) => count.category?.name ?? t.counts.wholeShop;

export function CountsScreen({ navigation }: Props) {
  const colors = useThemeColors();
  const t = useT();
  const queryClient = useQueryClient();
  const counts = useQuery({ queryKey: COUNTS_QUERY_KEY, queryFn: countsApi.list });
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const [scope, setScope] = useState('all');

  const start = useMutation({
    mutationFn: () => countsApi.start(scope === 'all' ? null : Number(scope)),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: COUNTS_QUERY_KEY });
      navigation.navigate('Count', { countId: count.id, title: scopeName(t, count) });
    },
  });

  if (counts.isPending) return <Loading />;
  if (counts.isError) return <ErrorState error={counts.error} onRetry={() => counts.refetch()} />;

  const open = counts.data.filter((count) => count.status === 'open');
  const waiting = counts.data.filter((count) => count.status === 'submitted');
  const scopeOptions = [
    { value: 'all', label: t.counts.wholeShop },
    ...(categories.data ?? []).map((category) => ({ value: String(category.id), label: category.name })),
  ];

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.intro, { color: colors.steel }]}>
        {t.counts.intro}
      </Text>

      {open.length > 0 && (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Text style={[styles.panelTitle, { color: colors.ink }]} accessibilityRole="header">
            {t.counts.carryOn}
          </Text>
          {open.map((count) => (
            <Pressable
              key={count.id}
              accessibilityRole="button"
              onPress={() => navigation.navigate('Count', { countId: count.id, title: scopeName(t, count) })}
              style={({ pressed }) => [styles.row, { borderTopColor: colors.line }, pressed && styles.pressed]}
            >
              <Text style={[styles.rowName, { color: colors.ink }]}>{scopeName(t, count)}</Text>
              <Text style={[styles.rowMeta, { color: colors.steel }]}>{t.counts.startedBy(count.startedBy?.name ?? null)}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {waiting.length > 0 && (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Text style={[styles.panelTitle, { color: colors.ink }]} accessibilityRole="header">
            {t.counts.waiting}
          </Text>
          {waiting.map((count) => (
            <View key={count.id} style={[styles.row, { borderTopColor: colors.line }]}>
              <Text style={[styles.rowName, { color: colors.ink }]}>{scopeName(t, count)}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.panelTitle, { color: colors.ink }]} accessibilityRole="header">
          {t.counts.start}
        </Text>
        <ChoiceRow label={t.counts.whatToCount} options={scopeOptions} value={scope} onChange={setScope} />
        {start.isError && <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(start.error)}</Text>}
        <Button label={t.counts.startCounting} onPress={() => start.mutate()} loading={start.isPending} />
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
