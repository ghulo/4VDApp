import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stepper } from '../components/inputs';
import { Button, EmptyState, ErrorState, Loading } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { countsApi } from '../services/api';
import type { StockCount } from '../services/types';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage } from '../utils/format';
import { COUNTS_QUERY_KEY } from './CountsScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'Count'>;

/** Index of the first product not counted yet at or after `from`, wrapping round; -1 when all are counted. */
function nextUncounted(count: StockCount, from: number): number {
  const total = count.lines.length;
  for (let step = 0; step < total; step++) {
    const index = (from + step) % total;
    if (count.lines[index]!.countedQuantity === null) return index;
  }
  return -1;
}

export function CountScreen({ route, navigation }: Props) {
  const { countId } = route.params;
  const queryClient = useQueryClient();
  const count = useQuery({ queryKey: [...COUNTS_QUERY_KEY, countId], queryFn: () => countsApi.get(countId) });

  if (count.isPending) return <Loading />;
  if (count.isError) return <ErrorState error={count.error} onRetry={() => count.refetch()} />;
  if (count.data.lines.length === 0) return <EmptyState title="There are no products to count here" />;
  if (count.data.status !== 'open') {
    return (
      <EmptyState title="This count is finished">
        {count.data.status === 'submitted' ? 'It is waiting for the owner.' : 'Start a new count to count again.'}
      </EmptyState>
    );
  }

  return (
    <Counter
      count={count.data}
      onSaved={(updated) => queryClient.setQueryData([...COUNTS_QUERY_KEY, countId], updated)}
      onSubmitted={() => {
        queryClient.invalidateQueries({ queryKey: COUNTS_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: ['approvals'] });
        navigation.goBack();
      }}
    />
  );
}

function Counter({
  count,
  onSaved,
  onSubmitted,
}: {
  count: StockCount;
  onSaved: (updated: StockCount) => void;
  onSubmitted: () => void;
}) {
  const colors = useThemeColors();
  const [index, setIndex] = useState(() => Math.max(0, nextUncounted(count, 0)));
  const line = count.lines[index]!;
  const [value, setValue] = useState(line.countedQuantity === null ? '' : String(line.countedQuantity));
  const [showList, setShowList] = useState(false);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);

  function goTo(nextIndex: number, source: StockCount = count) {
    const next = source.lines[nextIndex]!;
    setIndex(nextIndex);
    setValue(next.countedQuantity === null ? '' : String(next.countedQuantity));
    setShowList(false);
  }

  // Each line is saved as soon as it is counted, so closing the app loses nothing.
  const save = useMutation({
    mutationFn: () => countsApi.count(count.id, line.productId, Number(value)),
    onSuccess: (updated) => {
      onSaved(updated);
      const next = nextUncounted(updated, index + 1);
      if (next === -1) setConfirmingSubmit(true);
      else goTo(next, updated);
    },
  });
  const submit = useMutation({ mutationFn: () => countsApi.submit(count.id), onSuccess: onSubmitted });

  const uncounted = count.totals.products - count.totals.counted;
  const canSave = value !== '' && Number.isInteger(Number(value));

  if (showList) {
    return (
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
        {count.lines.map((item, itemIndex) => (
          <Pressable
            key={item.productId}
            accessibilityRole="button"
            onPress={() => goTo(itemIndex)}
            style={({ pressed }) => [styles.listRow, { borderTopColor: colors.line }, pressed && styles.pressed]}
          >
            <Text style={[styles.listName, { color: colors.ink }]} numberOfLines={1}>
              {item.productName}
            </Text>
            <Text style={[styles.listValue, { color: item.countedQuantity === null ? colors.steel : colors.ink }]}>
              {item.countedQuantity === null ? 'Not counted' : item.countedQuantity}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.progressRow}>
        <Text style={[styles.progress, { color: colors.steel }]}>
          {count.totals.counted} of {count.totals.products} counted
        </Text>
        <Pressable accessibilityRole="button" onPress={() => setShowList(true)} hitSlop={12}>
          <Text style={[styles.link, { color: colors.ink }]}>See the list</Text>
        </Pressable>
      </View>
      <View style={[styles.track, { backgroundColor: colors.line }]}>
        <View
          style={[styles.fill, { backgroundColor: colors.stockOk, width: `${(count.totals.counted / count.totals.products) * 100}%` }]}
        />
      </View>

      <View style={[styles.product, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.category, { color: colors.steel }]}>{line.categoryName}</Text>
        <Text style={[styles.name, { color: colors.ink }]}>{line.productName}</Text>
        {line.sku && <Text style={[styles.sku, { color: colors.steel }]}>SKU {line.sku}</Text>}
      </View>

      <Stepper label="How many are on the shelf?" value={value} onChange={setValue} size="large" />

      {save.isError && <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(save.error)}</Text>}
      <Button label="Save and next" onPress={() => save.mutate()} disabled={!canSave} loading={save.isPending} />
      <Button label="Skip for now" variant="quiet" onPress={() => goTo((index + 1) % count.lines.length)} />

      <View style={[styles.submitBox, { borderColor: colors.line }]}>
        {confirmingSubmit ? (
          <>
            <Text style={[styles.submitText, { color: colors.ink }]}>
              {uncounted === 0
                ? 'Everything is counted. Send it to the owner?'
                : `${uncounted} ${uncounted === 1 ? 'product is' : 'products are'} not counted and will be left as they are. Send it anyway?`}
            </Text>
            {submit.isError && <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(submit.error)}</Text>}
            <Button label="Send the count" onPress={() => submit.mutate()} loading={submit.isPending} />
            <Button label="Keep counting" variant="quiet" onPress={() => setConfirmingSubmit(false)} />
          </>
        ) : (
          <Button label="Finish count" variant="quiet" onPress={() => setConfirmingSubmit(true)} disabled={count.totals.counted === 0} />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progress: { fontFamily: fonts.bodyBold, fontSize: 15 },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, textDecorationLine: 'underline' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6 },
  product: { padding: spacing.lg, borderWidth: 1, borderRadius: radius.panel, gap: spacing.xs },
  category: { fontFamily: fonts.body, fontSize: 14 },
  name: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 34 },
  sku: { fontFamily: fonts.body, fontSize: 15 },
  error: { fontFamily: fonts.body, fontSize: 15 },
  submitBox: { marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, gap: spacing.sm },
  submitText: { fontFamily: fonts.body, fontSize: 16 },
  listRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
  listName: { flex: 1, fontFamily: fonts.body, fontSize: 16 },
  listValue: { fontFamily: fonts.bodyBold, fontSize: 16, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.7 },
});
