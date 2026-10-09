import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Truck } from 'phosphor-react-native/src/icons/Truck';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Confirmation } from '../components/Confirmation';
import { ChoiceRow, Stepper } from '../components/inputs';
import { Button, EmptyState, ErrorState, Loading, TextField } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { deliveriesApi } from '../services/api';
import type { Delivery } from '../services/types';
import { fonts, spacing, useThemeColors } from '../theme';
import { dayAfter, parseTypedDay, toTypedDay, typedDayHint } from '../utils/expiryDay';
import { errorMessage } from '../utils/format';
import { useT } from '../i18n/useT';

type Props = NativeStackScreenProps<RootStackParamList, 'Deliveries'>;

export const DELIVERIES_QUERY_KEY = ['orders', 'deliveries'];

/** Supplier orders on their way; tick one off when it arrives and what came goes into stock. */
export function DeliveriesScreen({ navigation }: Props) {
  const t = useT();
  const deliveries = useQuery({ queryKey: DELIVERIES_QUERY_KEY, queryFn: deliveriesApi.list });
  // Which order, when several are on their way; the oldest until someone picks.
  const [pickedId, setPickedId] = useState<number | null>(null);
  if (deliveries.isPending) return <Loading />;
  if (deliveries.isError) return <ErrorState error={deliveries.error} onRetry={() => deliveries.refetch()} />;

  const orders = deliveries.data;
  const order = orders.find((entry) => entry.id === pickedId) ?? orders[0];
  if (!order) {
    return (
      <EmptyState title={t.deliveries.none} icon={Truck}>
        {t.deliveries.noneDetail}
      </EmptyState>
    );
  }

  return (
    <>
      {orders.length > 1 && (
        <View style={styles.picker}>
          <ChoiceRow
            label={t.deliveries.which}
            options={orders.map((entry) => ({ value: String(entry.id), label: entry.supplierName }))}
            value={String(order.id)}
            onChange={(value) => setPickedId(Number(value))}
          />
        </View>
      )}
      {/* A fresh form per order, so its own lines show. */}
      <ReceiveForm key={order.id} order={order} onDone={() => navigation.goBack()} />
    </>
  );
}

function ReceiveForm({ order, onDone }: { order: Delivery; onDone: () => void }) {
  const t = useT();
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  // Per line: how many came (what was ordered until changed) and the typed expiry day.
  const [came, setCame] = useState(() => Object.fromEntries(order.lines.map((line) => [line.id, String(line.quantity)])));
  const [expiry, setExpiry] = useState<Record<number, string>>({});

  const counts = order.lines.map((line) => Number(came[line.id]));
  const units = counts.reduce((sum, count) => sum + count, 0);
  const badDay = (lineId: number) => (expiry[lineId] ?? '').trim() !== '' && parseTypedDay(expiry[lineId]!) === null;
  const isValid = counts.every((count) => Number.isInteger(count) && count >= 0) && !order.lines.some((line) => badDay(line.id));

  const save = useMutation({
    mutationFn: () =>
      deliveriesApi.receive(
        order.id,
        order.lines.map((line) => ({
          lineId: line.id,
          receivedQuantity: Number(came[line.id]),
          expiresOn: parseTypedDay(expiry[line.id] ?? ''),
        })),
      ),
    onSuccess: () => {
      for (const key of [['products'], ['inventory'], ['expiry'], ['reports']]) queryClient.invalidateQueries({ queryKey: key });
    },
  });

  if (save.isSuccess) {
    // The order list refreshes only on the way out: refreshing now would swap this confirmation for "Nothing on its way".
    const done = () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      onDone();
    };
    return <Confirmation title={t.deliveries.doneTitle} message={t.deliveries.doneMessage(units, order.supplierName)} onDone={done} />;
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: colors.ink }]}>{t.deliveries.from(order.supplierName, toTypedDay(dayAfter(new Date(order.createdAt), 0)))}</Text>
      {order.note && <Text style={[styles.hint, { color: colors.ink }]}>{order.note}</Text>}
      <Text style={[styles.hint, { color: colors.inkMuted }]}>{t.deliveries.intro}</Text>

      {order.lines.map((line) => (
        <View key={line.id} style={[styles.line, { borderTopColor: colors.line }]}>
          <Text style={[styles.product, { color: colors.ink }]}>{line.productName}</Text>
          <Text style={[styles.hint, { color: colors.steel }]}>{t.deliveries.ordered(line.quantity)}</Text>
          <Stepper
            label={t.deliveries.came}
            value={came[line.id] ?? ''}
            onChange={(value) => setCame((current) => ({ ...current, [line.id]: value }))}
            min={0}
            max={100_000}
          />
          <TextField
            label={t.deliveries.expiresOn}
            value={expiry[line.id] ?? ''}
            onChangeText={(text) => setExpiry((current) => ({ ...current, [line.id]: text }))}
            placeholder={typedDayHint}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          {badDay(line.id) && <Text style={[styles.hint, { color: colors.signalOut }]}>{t.expiry.badDate}</Text>}
        </View>
      ))}

      {save.isError && <Text style={[styles.hint, { color: colors.signalOut }]}>{errorMessage(save.error)}</Text>}
      <Button label={t.deliveries.save} onPress={() => save.mutate()} disabled={!isValid} loading={save.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  picker: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  content: { padding: spacing.lg, gap: spacing.sm },
  title: { fontFamily: fonts.displayBold, fontSize: 22 },
  hint: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  line: { borderTopWidth: 1, paddingTop: spacing.md, marginTop: spacing.sm, gap: spacing.xs },
  product: { fontFamily: fonts.bodyBold, fontSize: 17 },
});
