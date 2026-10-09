import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Confirmation } from '../components/Confirmation';
import { ChoiceRow } from '../components/inputs';
import { Button, ErrorState, Loading, TextField } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { carwashApi } from '../services/api';
import { fonts, spacing, useThemeColors } from '../theme';
import { errorMessage, formatMoney } from '../utils/format';
import { useT } from '../i18n/useT';

type Props = NativeStackScreenProps<RootStackParamList, 'Carwash'>;

const toNumber = (value: string) => Number(value.replace(',', '.'));
const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

/** Today's carwash takings: the wash and the change machine. Entering again replaces them. */
export function CarwashScreen({ navigation }: Props) {
  const t = useT();
  const today = useQuery({ queryKey: ['carwash', 'today'], queryFn: carwashApi.today });
  // Which carwash, when there are several; the first until someone picks.
  const [pickedId, setPickedId] = useState<number | null>(null);
  if (today.isPending) return <Loading />;
  if (today.isError) return <ErrorState error={today.error} onRetry={() => today.refetch()} />;

  const { carwashes, day } = today.data;
  const several = carwashes.length > 1;
  const carwash = carwashes.find((entry) => entry.id === pickedId) ?? carwashes[0];
  if (!carwash) return <ErrorState error={new Error(t.common.somethingWrong)} onRetry={() => today.refetch()} />;

  return (
    <>
      {several && (
        <View style={styles.picker}>
          <ChoiceRow
            label={t.carwash.which}
            options={carwashes.map((entry) => ({ value: String(entry.id), label: entry.name }))}
            value={String(carwash.id)}
            onChange={(value) => setPickedId(Number(value))}
          />
        </View>
      )}
      <CarwashForm
        // A fresh form for each carwash, so its own figures show.
        key={`${carwash.id}-${day}`}
        carwashId={carwash.id}
        name={several ? carwash.name : null}
        day={day}
        start={carwash.takings}
        onDone={() => navigation.goBack()}
        t={t}
      />
    </>
  );
}

function CarwashForm(props: {
  carwashId: number;
  /** Shown only when the business has several carwashes. */
  name: string | null;
  day: string;
  start: { carwash: number; change: number } | null;
  onDone: () => void;
  t: ReturnType<typeof useT>;
}) {
  const { carwashId, name, day, start, onDone, t } = props;
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const [carwash, setCarwash] = useState(start ? String(start.carwash) : '');
  const [change, setChange] = useState(start ? String(start.change) : '');
  const save = useMutation({
    mutationFn: () => carwashApi.save(carwashId, day, { carwash: toNumber(carwash), change: toNumber(change) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carwash'] });
      queryClient.invalidateQueries({ queryKey: ['cash'] });
    },
  });

  const isAmount = (value: string) => value.trim() !== '' && Number.isFinite(toNumber(value)) && toNumber(value) >= 0;
  const isValid = isAmount(carwash) && isAmount(change);

  if (save.isSuccess) {
    return (
      <Confirmation
        title={t.carwash.doneTitle}
        message={t.carwash.doneMessage(formatMoney(roundMoney(toNumber(carwash) + toNumber(change))), name)}
        onDone={onDone}
      />
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.hint, { color: colors.inkMuted }]}>{start ? t.carwash.alreadyEntered : t.carwash.intro}</Text>
      <TextField label={t.carwash.carwash} value={carwash} onChangeText={setCarwash} keyboardType="decimal-pad" placeholder="0,00" />
      <TextField label={t.carwash.change} value={change} onChangeText={setChange} keyboardType="decimal-pad" placeholder="0,00" />
      {isValid && (
        <Text style={[styles.total, { color: colors.ink }]}>{t.carwash.total(formatMoney(roundMoney(toNumber(carwash) + toNumber(change))))}</Text>
      )}
      {save.isError && <Text style={[styles.hint, { color: colors.signalOut }]}>{errorMessage(save.error)}</Text>}
      <Button label={t.carwash.save} onPress={() => save.mutate()} disabled={!isValid} loading={save.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  picker: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  content: { padding: spacing.lg, gap: spacing.sm },
  hint: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, marginBottom: spacing.sm },
  total: { fontFamily: fonts.bodyBold, fontSize: 18, fontVariant: ['tabular-nums'], marginBottom: spacing.sm },
});
