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
import { decidesRequests, useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, useThemeColors, type } from '../theme';
import { errorMessage, formatMoney } from '../utils/format';
import { useT } from '../i18n/useT';

type Props = NativeStackScreenProps<RootStackParamList, 'Return'>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export function ReturnScreen({ route, navigation }: Props) {
  const sale = route.params;
  const colors = useThemeColors();
  const t = useT();
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
  if (!decidesRequests(user) && settings.data) {
    if (refundAmount > settings.data.refundApprovalLimit) reasons.push(t.returns.reasonRefund(formatMoney(settings.data.refundApprovalLimit)));
    if (Date.now() - new Date(sale.saleDate).getTime() > settings.data.returnWindowDays * MS_PER_DAY) {
      reasons.push(t.returns.reasonLate(settings.data.returnWindowDays));
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
        title={t.returns.sentTitle}
        message={t.returns.sentMessage(refundText)}
        onDone={() => navigation.goBack()}
      />
    ) : (
      <Confirmation
        title={t.returns.doneTitle}
        message={t.returns.doneMessage({ refund: refundText, damaged: condition === 'damaged' })}
        onDone={() => navigation.goBack()}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
        <Text style={[styles.title, { color: colors.ink }]}>{sale.productName}</Text>
        <Text style={[styles.muted, { color: colors.steel }]}>
          {t.returns.sold(sale.quantity, formatMoney(sale.pricePerUnit))}{' '}
          {sale.returnedQuantity > 0 ? t.returns.alreadyReturned(sale.returnedQuantity) : null}
        </Text>
      </View>

      <Stepper label={t.returns.unitsBack} value={quantity} onChange={setQuantity} min={1} max={left} />
      <ChoiceRow
        label={t.returns.condition}
        options={[
          { value: 'resellable' as const, label: t.returns.resellable },
          { value: 'damaged' as const, label: t.returns.damaged },
        ]} value={condition} onChange={setCondition} />
      <TextField
        label={t.returns.refund(isQuantityValid ? formatMoney(paid) : '…')}
        value={refund}
        onChangeText={setRefund}
        placeholder={isQuantityValid ? paid.toFixed(2) : ''}
        keyboardType="decimal-pad"
      />
      <TextField label={t.returns.note} value={notes} onChangeText={setNotes} maxLength={1000} />

      <View style={[styles.notice, { borderColor: reasons.length ? colors.signalLow : colors.line, backgroundColor: colors.surface }]}>
        <Text style={[styles.noticeText, { color: colors.ink }]}>
          {reasons.length === 0
            ? t.returns.straightAway
            : t.returns.needsOwner(reasons.join(t.returns.and))}
        </Text>
      </View>

      {submit.isError && <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(submit.error)}</Text>}
      <Button
        label={isRefundValid && isQuantityValid ? t.returns.returnAndRefund(formatMoney(refundAmount)) : t.returns.return}
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
  title: { fontFamily: fonts.display, fontSize: type.headline },
  muted: { fontFamily: fonts.body, fontSize: type.body },
  notice: { padding: spacing.md, borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.small, marginBottom: spacing.md },
  noticeText: { fontFamily: fonts.body, fontSize: type.body },
  error: { fontFamily: fonts.body, fontSize: type.body },
});
