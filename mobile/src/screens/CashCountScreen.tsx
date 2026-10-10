import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Confirmation } from '../components/Confirmation';
import { ChoiceRow } from '../components/inputs';
import { Button, ErrorState, Loading, TextField } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { cashApi } from '../services/api';
import { fonts, spacing, useThemeColors, type } from '../theme';
import { errorMessage, formatMoney } from '../utils/format';
import { useT } from '../i18n/useT';
import { carwashLabel } from '../utils/shift';

type Props = NativeStackScreenProps<RootStackParamList, 'CashCount'>;

const toAmount = (text: string) => Number(text.replace(',', '.'));
const isAmount = (text: string) => text.trim() !== '' && Number.isFinite(toAmount(text)) && toAmount(text) >= 0;

/**
 * Closing up: count everything in the drawer. Blind on purpose: the screen
 * never shows what the app expects, so the count is what's really there.
 */
export function CashCountScreen({ navigation, route }: Props) {
  const colors = useThemeColors();
  const t = useT();
  const queryClient = useQueryClient();
  const today = useQuery({ queryKey: ['cash', 'today'], queryFn: cashApi.today });
  // Which drawer: "shop" or "carwash:<id>". Until someone picks: the one asked for, else the first not counted yet.
  const [picked, setDrawer] = useState<string | null>(route.params?.drawer ?? null);
  const [counted, setCounted] = useState('');
  // Null until someone changes it: then the drawer's usual float (or the one already counted today).
  const [floatInput, setFloatInput] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // Commas are how many people here type decimals: "120,50".
  const amount = toAmount(counted);

  const submit = useMutation({
    mutationFn: ({ drawer, float }: { drawer: string; float: number }) => {
      const input = { counted: amount, float, note: note.trim() || null };
      return drawer === 'shop'
        ? cashApi.count({ place: 'shop', ...input })
        : cashApi.count({ place: 'carwash', carwashId: Number(drawer.split(':')[1]), ...input });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cash'] }),
  });

  if (today.isPending) return <Loading />;
  if (today.isError) return <ErrorState error={today.error} onRetry={() => today.refetch()} />;

  // The shop, then each open carwash; a carwash is named only when there are several.
  const several = today.data.filter((entry) => entry.place === 'carwash').length > 1;
  const drawers = today.data.map((entry) => ({
    key: entry.place === 'shop' ? 'shop' : `carwash:${entry.carwashId}`,
    label: entry.place === 'shop' ? t.cash.places.shop : carwashLabel(t.cash.places.carwash, entry.name, several),
    entry,
  }));
  const chosen =
    drawers.find((option) => option.key === picked) ?? drawers.find((option) => !option.entry.countedAt) ?? drawers[0]!;
  const status = chosen.entry;
  const floatText = floatInput ?? String(status.float).replace('.', ',');
  const float = toAmount(floatText);
  const isValid = isAmount(counted) && isAmount(floatText);

  if (submit.isSuccess) {
    return (
      <Confirmation
        title={t.cash.doneTitle}
        message={t.cash.doneMessage(drawers.find((option) => option.key === submit.variables?.drawer)?.label ?? chosen.label, formatMoney(amount))}
        onDone={() => navigation.goBack()}
      />
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ChoiceRow
        label={t.cash.whichDrawer}
        options={drawers.map((option) => ({ value: option.key, label: option.label }))}
        value={chosen.key}
        onChange={(key) => {
          setDrawer(key);
          setFloatInput(null);
        }}
      />
      <TextField label={t.cash.float} value={floatText} onChangeText={setFloatInput} keyboardType="decimal-pad" placeholder="0,00" />
      <Text style={[styles.hint, { color: colors.inkMuted }]}>
        {float > 0 ? t.cash.includeFloat(formatMoney(float)) : t.cash.countAll}
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
      <Button label={t.cash.save} onPress={() => submit.mutate({ drawer: chosen.key, float })} disabled={!isValid} loading={submit.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm },
  hint: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 21, marginBottom: spacing.sm },
  error: { fontFamily: fonts.body, fontSize: type.body },
});
