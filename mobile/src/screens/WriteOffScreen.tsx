import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Confirmation } from '../components/Confirmation';
import { ChoiceRow, Stepper } from '../components/inputs';
import { Button, TextField } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { writeOffsApi } from '../services/api';
import type { WriteOffReason } from '../services/types';
import { decidesRequests, useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, useThemeColors, type } from '../theme';
import { errorMessage } from '../utils/format';
import { useT } from '../i18n/useT';

type Props = NativeStackScreenProps<RootStackParamList, 'WriteOff'>;

const REASONS = ['damaged', 'lost', 'expired', 'other'] as const;

export function WriteOffScreen({ route, navigation }: Props) {
  const { productId, productName, inStock } = route.params;
  const colors = useThemeColors();
  const t = useT();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState<WriteOffReason>('damaged');
  const [notes, setNotes] = useState('');

  const units = Number(quantity);
  const isValid = Number.isInteger(units) && units >= 1 && units <= inStock;

  const submit = useMutation({
    mutationFn: () => writeOffsApi.request({ productId, quantity: units, reason, notes: notes.trim() || null }),
    onSuccess: () => {
      for (const key of [['products'], ['inventory'], ['approvals']]) queryClient.invalidateQueries({ queryKey: key });
    },
  });

  if (submit.data) {
    const what = `${submit.data.quantity} × ${productName}`;
    return submit.data.status === 'pending' ? (
      <Confirmation
        title={t.writeOff.sentTitle}
        message={t.writeOff.sentMessage(what)}
        onDone={() => navigation.goBack()}
      />
    ) : (
      <Confirmation title={t.writeOff.doneTitle} message={t.writeOff.doneMessage(what)} onDone={() => navigation.goBack()} />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: colors.ink }]}>{productName}</Text>
      <Text style={[styles.muted, { color: colors.steel }]}>{inStock} in stock</Text>

      <Stepper label={t.writeOff.howMany} value={quantity} onChange={setQuantity} min={1} max={inStock} />
      <ChoiceRow
        label={t.writeOff.whatHappened}
        options={REASONS.map((value) => ({ value, label: t.writeOff.reasons[value] }))} value={reason} onChange={setReason} />
      <TextField
        label={t.writeOff.note}
        value={notes}
        onChangeText={setNotes}
        maxLength={1000}
        placeholder={t.writeOff.notePlaceholder}
      />

      {!decidesRequests(user) && (
        <View style={[styles.notice, { borderColor: colors.signalLow, backgroundColor: colors.surface }]}>
          <Text style={[styles.noticeText, { color: colors.ink }]}>{t.writeOff.ownerApproves}</Text>
        </View>
      )}

      {submit.isError && <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(submit.error)}</Text>}
      <Button
        label={decidesRequests(user) ? t.writeOff.writeOff : t.writeOff.send}
        onPress={() => submit.mutate()}
        disabled={!isValid}
        loading={submit.isPending}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm },
  title: { fontFamily: fonts.display, fontSize: type.headline },
  muted: { fontFamily: fonts.body, fontSize: type.body, marginBottom: spacing.md },
  notice: { padding: spacing.md, borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.small, marginBottom: spacing.md },
  noticeText: { fontFamily: fonts.body, fontSize: type.body },
  error: { fontFamily: fonts.body, fontSize: type.body },
});
