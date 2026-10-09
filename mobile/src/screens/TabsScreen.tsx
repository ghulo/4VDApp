import { Notebook } from 'phosphor-react-native/src/icons/Notebook';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, EmptyState, ErrorState, Loading, TextField } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { customersApi } from '../services/api';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage, formatDateWith, formatMoney } from '../utils/format';
import { useT } from '../i18n/useT';

const day = (iso: string) => formatDateWith(new Date(iso), { day: 'numeric', month: 'short' });

/** What they owe, their credit (from an undone sale they'd paid for), or settled. */
const owedText = (balance: number, t: ReturnType<typeof useT>) =>
  balance > 0 ? formatMoney(balance) : balance < 0 ? t.tabs.credit(formatMoney(-balance)) : t.tabs.settled;

/** Everyone with a tab, most owed first. */
export function TabsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Tabs'>) {
  const colors = useThemeColors();
  const t = useT();
  const customers = useQuery({ queryKey: ['customers'], queryFn: customersApi.list });

  if (customers.isPending) return <Loading />;
  if (customers.isError) return <ErrorState error={customers.error} onRetry={() => customers.refetch()} />;
  if (customers.data.length === 0) return <EmptyState icon={Notebook} title={t.tabs.none}>{t.tabs.noneHint}</EmptyState>;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
        {customers.data.map((customer, index) => (
          <Pressable
            key={customer.id}
            accessibilityRole="button"
            onPress={() => navigation.navigate('Tab', { customerId: customer.id, name: customer.name })}
            style={({ pressed }) => [
              styles.row,
              { borderTopColor: colors.line, borderTopWidth: index === 0 ? 0 : 1, backgroundColor: pressed ? colors.fill : 'transparent' },
            ]}
          >
            <View style={styles.rowText}>
              <Text style={[styles.name, { color: colors.ink }]}>{customer.name}</Text>
              {customer.owingSince && <Text style={[styles.muted, { color: colors.inkMuted }]}>{t.tabs.since(day(customer.owingSince))}</Text>}
            </View>
            <Text style={[styles.amount, { color: customer.balance > 0 ? colors.ink : colors.inkMuted }]}>
              {owedText(customer.balance, t)}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

/** One tab: what's owed, its history, and taking a payment. */
export function TabScreen({ route }: NativeStackScreenProps<RootStackParamList, 'Tab'>) {
  const colors = useThemeColors();
  const t = useT();
  const queryClient = useQueryClient();
  const { customerId } = route.params;
  const customer = useQuery({ queryKey: ['customers', customerId], queryFn: () => customersApi.detail(customerId) });
  const [amount, setAmount] = useState('');
  const pay = useMutation({
    mutationFn: () => customersApi.pay(customerId, { amount: Number(amount.replace(',', '.')), note: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['cash'] });
      setAmount('');
    },
  });

  if (customer.isPending) return <Loading />;
  if (customer.isError) return <ErrorState error={customer.error} onRetry={() => customer.refetch()} />;
  const data = customer.data;
  const value = Number(amount.replace(',', '.'));
  const isValid = value > 0 && value <= data.balance;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.panel, styles.padded, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
        <Text style={[styles.muted, { color: colors.inkMuted }]}>{t.tabs.owesLabel}</Text>
        <Text style={[styles.big, { color: colors.ink }]}>{owedText(data.balance, t)}</Text>
        {data.owingSince && <Text style={[styles.muted, { color: colors.inkMuted }]}>{t.tabs.since(day(data.owingSince))}</Text>}
        {data.phone && <Text style={[styles.muted, { color: colors.inkMuted }]}>{data.phone}</Text>}
      </View>

      {data.balance > 0 && (
        <View style={[styles.panel, styles.padded, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
          <TextField label={t.tabs.paying} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
          <Pressable accessibilityRole="button" onPress={() => setAmount(String(data.balance))} hitSlop={8}>
            <Text style={[styles.link, { color: colors.ink }]}>{t.tabs.payAll(formatMoney(data.balance))}</Text>
          </Pressable>
          {pay.isError && <Text style={[styles.muted, { color: colors.signalOut }]}>{errorMessage(pay.error)}</Text>}
          {pay.isSuccess && <Text style={[styles.muted, { color: colors.stockOk }]}>{t.tabs.paid}</Text>}
          <Button label={t.tabs.takePayment} onPress={() => pay.mutate()} disabled={!isValid} loading={pay.isPending} />
        </View>
      )}

      <Text style={[styles.section, { color: colors.ink }]}>{t.tabs.history}</Text>
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
        {data.entries.map((entry, index) => (
          <View key={entry.id} style={[styles.row, { borderTopColor: colors.line, borderTopWidth: index === 0 ? 0 : 1, opacity: entry.undone ? 0.5 : 1 }]}>
            <View style={styles.rowText}>
              <Text style={[styles.name, { color: colors.ink }]}>
                {entry.kind === 'payment' ? t.tabs.payment : entry.kind === 'refund' ? t.tabs.refund(entry.note ?? '') : (entry.note ?? t.tabs.charge)}
              </Text>
              <Text style={[styles.muted, { color: colors.inkMuted }]}>
                {day(entry.at)}
                {entry.undone ? ` · ${t.tabs.undone}` : ''}
              </Text>
            </View>
            <Text style={[styles.amount, { color: entry.kind === 'charge' ? colors.ink : colors.stockOk }]}>
              {entry.kind === 'charge' ? formatMoney(entry.amount) : `−${formatMoney(entry.amount)}`}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  panel: { borderWidth: 1, borderRadius: radius.panel, overflow: 'hidden' },
  padded: { padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 56 },
  rowText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16 },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  amount: { fontFamily: fonts.bodyBold, fontSize: 16, fontVariant: ['tabular-nums'] },
  big: { fontFamily: fonts.bodyBold, fontSize: 32, fontVariant: ['tabular-nums'] },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, textDecorationLine: 'underline' },
  section: { fontFamily: fonts.bodyBold, fontSize: 17, marginTop: spacing.sm },
});
