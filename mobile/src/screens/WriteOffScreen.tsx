import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChoiceRow, Stepper } from '../components/inputs';
import { Button, TextField } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { writeOffsApi } from '../services/api';
import type { WriteOffReason } from '../services/types';
import { useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'WriteOff'>;

const REASONS = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost' },
  { value: 'expired', label: 'Expired' },
  { value: 'other', label: 'Other' },
] as const;

export function WriteOffScreen({ route, navigation }: Props) {
  const { productId, productName, inStock } = route.params;
  const colors = useThemeColors();
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
      navigation.goBack();
    },
  });

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: colors.ink }]}>{productName}</Text>
      <Text style={[styles.muted, { color: colors.steel }]}>{inStock} in stock</Text>

      <Stepper label="How many" value={quantity} onChange={setQuantity} min={1} max={inStock} />
      <ChoiceRow label="What happened" options={REASONS} value={reason} onChange={setReason} />
      <TextField label="Note (optional)" value={notes} onChangeText={setNotes} maxLength={1000} placeholder="e.g. dropped in the stockroom" />

      {user.role !== 'admin' && (
        <View style={[styles.notice, { borderColor: colors.signalLow, backgroundColor: colors.surface }]}>
          <Text style={[styles.noticeText, { color: colors.ink }]}>The owner approves this before it leaves the stock.</Text>
        </View>
      )}

      {submit.isError && <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(submit.error)}</Text>}
      <Button
        label={user.role === 'admin' ? 'Write off' : 'Send to the owner'}
        onPress={() => submit.mutate()}
        disabled={!isValid}
        loading={submit.isPending}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm },
  title: { fontFamily: fonts.displayBold, fontSize: 26 },
  muted: { fontFamily: fonts.body, fontSize: 15, marginBottom: spacing.md },
  notice: { padding: spacing.md, borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.small, marginBottom: spacing.md },
  noticeText: { fontFamily: fonts.body, fontSize: 15 },
  error: { fontFamily: fonts.body, fontSize: 15 },
});
