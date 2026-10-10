import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Confirmation } from '../components/Confirmation';
import { ChoiceRow, Stepper } from '../components/inputs';
import { Button, TextField } from '../components/ui';
import { useT } from '../i18n/useT';
import type { RootStackParamList } from '../navigation/types';
import { expiryApi } from '../services/api';
import { fonts, spacing, useThemeColors, type } from '../theme';
import { dayAfter, parseTypedDay, toTypedDay, typedDayHint } from '../utils/expiryDay';
import { errorMessage } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Expiry'>;

/** Days ahead for each quick pick; the day is then editable like any typed one. */
const QUICK_DAYS = { week: 7, twoWeeks: 14, month: 30, threeMonths: 91, sixMonths: 182 } as const;
type Quick = keyof typeof QUICK_DAYS;

/** Notes when some units of a product expire. Always optional: most products never need it. */
export function ExpiryScreen({ route, navigation }: Props) {
  const { productId, productName } = route.params;
  const colors = useThemeColors();
  const t = useT();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState('1');
  const [typed, setTyped] = useState('');
  // '' = typed by hand, so no quick pick is lit.
  const [quick, setQuick] = useState<Quick | ''>('');
  const [note, setNote] = useState('');

  const units = Number(quantity);
  const day = parseTypedDay(typed);
  const showsBadDate = typed.trim() !== '' && day === null;
  const isValid = Number.isInteger(units) && units >= 1 && day !== null;

  const save = useMutation({
    mutationFn: () => expiryApi.add({ productId, quantity: units, expiresOn: day!, note: note.trim() || null }),
    onSuccess: () => {
      for (const key of [['expiry'], ['reports'], ['activity']]) queryClient.invalidateQueries({ queryKey: key });
    },
  });

  function pickQuick(value: Quick | '') {
    if (value === '') return;
    setQuick(value);
    setTyped(toTypedDay(dayAfter(new Date(), QUICK_DAYS[value])));
  }

  if (save.isSuccess) {
    return (
      <Confirmation
        title={t.expiry.doneTitle}
        message={t.expiry.doneMessage(`${units} × ${productName}`, toTypedDay(day!))}
        onDone={() => navigation.goBack()}
      />
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: colors.ink }]}>{productName}</Text>
      <Text style={[styles.muted, { color: colors.steel }]}>{t.expiry.optional}</Text>

      <Stepper label={t.expiry.howMany} value={quantity} onChange={setQuantity} min={1} max={100_000} />
      <ChoiceRow
        label={t.expiry.quickPick}
        options={(Object.keys(QUICK_DAYS) as Quick[]).map((value) => ({ value, label: t.expiry.quick[value] }))}
        value={quick}
        onChange={pickQuick}
      />
      <TextField
        label={t.expiry.expiresOn}
        value={typed}
        onChangeText={(text) => {
          setTyped(text);
          setQuick('');
        }}
        placeholder={typedDayHint}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      {showsBadDate && <Text style={[styles.error, { color: colors.signalOut }]}>{t.expiry.badDate}</Text>}
      <TextField label={t.expiry.note} value={note} onChangeText={setNote} maxLength={500} />

      {save.isError && <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(save.error)}</Text>}
      <Button label={t.expiry.save} onPress={() => save.mutate()} disabled={!isValid} loading={save.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm },
  title: { fontFamily: fonts.display, fontSize: type.headline },
  muted: { fontFamily: fonts.body, fontSize: type.body, marginBottom: spacing.md },
  error: { fontFamily: fonts.body, fontSize: type.body },
});
