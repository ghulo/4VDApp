import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Confirmation } from '../components/Confirmation';
import { ChoiceRow, Stepper } from '../components/inputs';
import { Button, TextField } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { returnsApi, settingsApi } from '../services/api';
import type { ReturnCondition } from '../services/types';
import { useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage, formatMoney } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Return'>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CONDITIONS = [
  { value: 'resellable', label: 'Back on the shelf' },
  { value: 'damaged', label: 'Damaged' },
] as const;

export function ReturnScreen({ route, navigation }: Props) {
  const sale = route.params;
  const colors = useThemeColors();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const left = sale.quantity - sale.returnedQuantity;
  const [quantity, setQuantity] = useState(String(left));
  const [condition, setCondition] = useState<ReturnCondition>('resellable');
  const [refund, setRefund] = useState('');
  const [notes, setNotes] = useState('');
  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });

  const units = Number(quantity);
  const isQuantityValid = Number.isInteger(units) && units >= 1 && units <= left;
  const paid = Math.round(units * sale.pricePerUnit * 100) / 100;
  const refundAmount = refund === '' ? paid : Number(refund.replace(',', '.'));
  const isRefundValid = Number.isFinite(refundAmount) && refundAmount >= 0 && refundAmount <= paid;

  // Same rules as the server, so the employee knows before sending.
  const reasons: string[] = [];
  if (user.role !== 'admin' && settings.data) {
    if (refundAmount > settings.data.refundApprovalLimit) reasons.push(`the refund is over ${formatMoney(settings.data.refundApprovalLimit)}`);
    if (Date.now() - new Date(sale.saleDate).getTime() > settings.data.returnWindowDays * MS_PER_DAY) {
      reasons.push(`it was sold more than ${settings.data.returnWindowDays} days ago`);
    }
    if (condition === 'damaged') reasons.push('it is damaged');
  }

  const submit = useMutation({
    mutationFn: () =>
      returnsApi.request(sale.saleId, {
        quantity: units,
        condition,
        ...(refund !== '' && { refundAmount }),
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      for (const key of [['reports'], ['products'], ['inventory'], ['approvals']]) queryClient.invalidateQueries({ queryKey: key });
    },
  });

  if (submit.data) {
    const refundText = formatMoney(submit.data.refundAmount);
    return submit.data.status === 'pending' ? (
      <Confirmation
        title="Sent to the owner"
        message={`Don't give the ${refundText} refund yet. The owner has to approve this return first. You'll see the answer under Your requests on Home.`}
        onDone={() => navigation.goBack()}
      />
    ) : (
      <Confirmation
        title="Returned"
        message={`Give the customer ${refundText}. ${condition === 'damaged' ? 'The damaged units were written off.' : 'The units are back in stock.'}`}
        onDone={() => navigation.goBack()}
      />
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.title, { color: colors.ink }]}>{sale.productName}</Text>
        <Text style={[styles.muted, { color: colors.steel }]}>
          Sold {sale.quantity} at {formatMoney(sale.pricePerUnit)} each.{' '}
          {sale.returnedQuantity > 0 && `${sale.returnedQuantity} already returned.`}
        </Text>
      </View>

      <Stepper label="Units coming back" value={quantity} onChange={setQuantity} min={1} max={left} />
      <ChoiceRow label="Condition" options={CONDITIONS} value={condition} onChange={setCondition} />
      <TextField
        label={`Refund (they paid ${isQuantityValid ? formatMoney(paid) : '…'})`}
        value={refund}
        onChangeText={setRefund}
        placeholder={isQuantityValid ? paid.toFixed(2) : ''}
        keyboardType="decimal-pad"
      />
      <TextField label="Note (optional)" value={notes} onChangeText={setNotes} maxLength={1000} />

      <View style={[styles.notice, { borderColor: reasons.length ? colors.signalLow : colors.line, backgroundColor: colors.surface }]}>
        <Text style={[styles.noticeText, { color: colors.ink }]}>
          {reasons.length === 0
            ? 'This return goes through straight away.'
            : `This return needs the owner's approval because ${reasons.join(' and ')}. Nothing changes until then.`}
        </Text>
      </View>

      {submit.isError && <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(submit.error)}</Text>}
      <Button
        label={isRefundValid && isQuantityValid ? `Return and refund ${formatMoney(refundAmount)}` : 'Return'}
        onPress={() => submit.mutate()}
        disabled={!isQuantityValid || !isRefundValid}
        loading={submit.isPending}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm },
  panel: { padding: spacing.lg, borderWidth: 1, borderRadius: radius.panel, gap: spacing.xs, marginBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 24 },
  muted: { fontFamily: fonts.body, fontSize: 15 },
  notice: { padding: spacing.md, borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.small, marginBottom: spacing.md },
  noticeText: { fontFamily: fonts.body, fontSize: 15 },
  error: { fontFamily: fonts.body, fontSize: 15 },
});
