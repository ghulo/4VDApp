import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Confirmation } from '../components/Confirmation';
import { ChoiceRow } from '../components/inputs';
import { Button, ErrorState, Loading, TextField } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { cashApi } from '../services/api';
import type { CashPlace } from '../services/types';
import { fonts, spacing, useThemeColors } from '../theme';
import { errorMessage, formatMoney } from '../utils/format';
import { useT } from '../i18n/useT';

type Props = NativeStackScreenProps<RootStackParamList, 'CashCount'>;

const PLACES: CashPlace[] = ['shop', 'carwash'];

/**
 * Closing up: count everything in the drawer. Blind on purpose: the screen
 * never shows what the app expects, so the count is what's really there.
 */
export function CashCountScreen({ navigation }: Props) {
  const colors = useThemeColors();
  const t = useT();
  const queryClient = useQueryClient();
  const today = useQuery({ queryKey: ['cash', 'today'], queryFn: cashApi.today });
  const [place, setPlace] = useState<CashPlace>('shop');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');

  // Commas are how many people here type decimals: "120,50".
  const amount = Number(counted.replace(',', '.'));
  const isValid = counted.trim() !== '' && Number.isFinite(amount) && amount >= 0;

  const submit = useMutation({
    mutationFn: () => cashApi.count({ place, counted: amount, note: note.trim() || null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cash'] }),
  });

  if (submit.isSuccess) {
    return (
      <Confirmation
        title={t.cash.doneTitle}
        message={t.cash.doneMessage(t.cash.places[place], formatMoney(amount))}
        onDone={() => navigation.goBack()}
      />
    );
  }
  if (today.isPending) return <Loading />;
  if (today.isError) return <ErrorState error={today.error} onRetry={() => today.refetch()} />;

  const status = today.data.find((entry) => entry.place === place)!;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ChoiceRow
        label={t.cash.whichDrawer}
        options={PLACES.map((value) => ({ value, label: t.cash.places[value] }))}
        value={place}
        onChange={setPlace}
      />
      <Text style={[styles.hint, { color: colors.inkMuted }]}>
        {status.float > 0 ? t.cash.includeFloat(formatMoney(status.float)) : t.cash.countAll}
      </Text>
      <TextField
        label={t.cash.counted}
        value={counted}
        onChangeText={setCounted}
        keyboardType="decimal-pad"
        placeholder="0,00"
      />
      <TextField label={t.cash.note} value={note} onChangeText={setNote} maxLength={500} placeholder={t.cash.notePlaceholder} />
      {status.countedAt && <Text style={[styles.hint, { color: colors.inkMuted }]}>{t.cash.alreadyCounted(status.countedBy)}</Text>}
      {submit.isError && <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(submit.error)}</Text>}
      <Button label={t.cash.save} onPress={() => submit.mutate()} disabled={!isValid} loading={submit.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm },
  hint: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, marginBottom: spacing.sm },
  error: { fontFamily: fonts.body, fontSize: 15 },
});
