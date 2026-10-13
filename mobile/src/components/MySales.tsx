import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CaretDown } from 'phosphor-react-native/src/icons/CaretDown';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RootStackParamList } from '../navigation/types';
import { documentsApi, reportsApi, salesApi } from '../services/api';
import type { Checkout, DocumentRef } from '../services/types';
import { fonts, keyShadow, keyTravel, radius, spacing, useThemeColors, type } from '../theme';
import { errorMessage, formatDateWith, formatHeadlineMoney, formatMoney } from '../utils/format';
import { useT } from '../i18n/useT';
import { canPrint, printDocument } from '../utils/printDocument';
import { Button, ErrorState } from './ui';

/** How many of this month's sales the list shows. */
const CHECKOUTS_SHOWN = 50;

/**
 * This calendar month and last calendar month, in the phone's own timezone.
 * Last month is sent explicitly so "Last month" really means last month,
 * not "the same number of days before the 1st".
 */
export function monthRanges(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  return {
    startDate: start.toISOString(),
    endDate: new Date(year, month + 1, 1).toISOString(),
    previousStartDate: new Date(year, month - 1, 1).toISOString(),
    previousEndDate: start.toISOString(),
    name: formatDateWith(start, { month: 'long' }),
  };
}

export const MY_SALES_QUERY_KEY = ['reports', 'my-sales'];

/** Your own checkouts in a range; under MY_SALES_QUERY_KEY so a new sale refreshes them. */
export function useMyCheckouts(range: { startDate: string; endDate: string }, limit: number, enabled = true) {
  return useQuery({
    queryKey: [...MY_SALES_QUERY_KEY, 'checkouts', range.startDate, limit],
    queryFn: () => salesApi.myCheckouts({ startDate: range.startDate, endDate: range.endDate, limit }),
    enabled,
  });
}

/** "10:42" for today, "4 Oct, 10:42" for earlier days. */
export function saleTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return date.toDateString() === now.toDateString()
    ? formatDateWith(date, { hour: '2-digit', minute: '2-digit' })
    : formatDateWith(date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** "3 × Milk, 2 × Bread" for a checkout's lines. */
export function checkoutSummary(checkout: Checkout): string {
  return checkout.lines.map((line) => `${line.quantity} × ${line.productName}`).join(', ');
}

/** Your month in one figure, then every sale (checkout) this month; a sale opens to its lines and returns. */
export function MySales() {
  const colors = useThemeColors();
  const t = useT();
  const month = monthRanges(new Date());
  const mySales = useQuery({
    queryKey: [...MY_SALES_QUERY_KEY, month.startDate],
    queryFn: () => reportsApi.mySales(month),
  });
  const checkouts = useMyCheckouts(month, CHECKOUTS_SHOWN);

  return (
    <View style={styles.stack}>
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
        <Text style={[styles.title, { color: colors.ink }]}>{t.mySales.title(month.name)}</Text>
        {mySales.isPending && <Text style={[styles.muted, { color: colors.steel }]}>{t.mySales.loading}</Text>}
        {mySales.isError && <Text style={[styles.muted, { color: colors.signalOut }]}>{errorMessage(mySales.error)}</Text>}
        {mySales.data && (
          <>
            <Text style={[styles.hero, { color: colors.ink }]}>{formatHeadlineMoney(mySales.data.current.revenue)}</Text>
            <Text style={[styles.muted, { color: colors.steel }]}>
              {t.mySales.summary({
                sales: mySales.data.current.salesCount,
                units: mySales.data.current.unitsSold,
                refunds: mySales.data.current.refunds > 0 ? formatMoney(mySales.data.current.refunds) : null,
                lastMonth: formatMoney(mySales.data.previous.revenue),
              })}
            </Text>
          </>
        )}
      </View>

      <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
        {t.mySales.sales}
      </Text>
      {checkouts.isPending && <Text style={[styles.muted, { color: colors.steel }]}>{t.mySales.loading}</Text>}
      {checkouts.isError && <ErrorState error={checkouts.error} onRetry={() => checkouts.refetch()} />}
      {checkouts.data?.length === 0 && <Text style={[styles.muted, { color: colors.steel }]}>{t.mySales.none}</Text>}
      {checkouts.data && checkouts.data.length > 0 && (
        <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
          {checkouts.data.map((checkout, index) => (
            <CheckoutRow key={checkout.key} checkout={checkout} first={index === 0} />
          ))}
        </View>
      )}
    </View>
  );
}

/** One sale: when, its invoice and total; tap to see its lines and return any of them. */
function CheckoutRow({ checkout, first }: { checkout: Checkout; first: boolean }) {
  const colors = useThemeColors();
  const t = useT();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [open, setOpen] = useState(false);
  const print = useMutation({
    mutationFn: (document: DocumentRef) => printDocument(() => documentsApi.printPage(document.id), document.number),
  });
  const allReturned = checkout.lines.every((line) => line.returnedQuantity >= line.quantity);

  return (
    <View style={!first && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }}>
      <Pressable
        accessibilityRole="button"
        aria-expanded={open}
        accessibilityLabel={`${saleTime(checkout.saleDate)}, ${formatMoney(checkout.total)}. ${checkoutSummary(checkout)}`}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [styles.head, pressed && { backgroundColor: colors.surfaceSunk }]}
      >
        <View style={styles.headText}>
          <Text style={[styles.time, { color: colors.steel }]}>
            {saleTime(checkout.saleDate)}
            {checkout.invoice ? ` · ${checkout.invoice.number}` : ''}
          </Text>
          <Text style={[styles.summary, { color: colors.ink }]} numberOfLines={open ? undefined : 1}>
            {checkoutSummary(checkout)}
          </Text>
          {allReturned && <Text style={[styles.time, { color: colors.steel }]}>{t.mySales.returned}</Text>}
        </View>
        <Text style={[styles.amount, { color: colors.ink }]}>{formatMoney(checkout.total)}</Text>
        <CaretDown size={16} color={colors.inkMuted} style={open ? styles.caretOpen : undefined} />
      </Pressable>
      {open && (
        <View style={[styles.lines, { backgroundColor: colors.background }]}>
          {checkout.lines.map((line) => {
            const left = line.quantity - line.returnedQuantity;
            return (
              <View key={line.id} style={styles.line}>
                <View style={styles.headText}>
                  <Text style={[styles.summary, { color: colors.ink }]}>
                    {line.quantity} × {line.productName}
                  </Text>
                  <Text style={[styles.time, { color: colors.steel }]}>
                    {formatMoney(line.totalAmount)}
                    {line.returnedQuantity > 0 ? ` · ${t.mySales.returnedSome(line.returnedQuantity)}` : ''}
                  </Text>
                </View>
                {left > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.mySales.returnLabel(line.productName)}
                    onPress={() =>
                      navigation.navigate('Return', {
                        saleId: line.id,
                        productName: line.productName,
                        quantity: line.quantity,
                        pricePerUnit: line.pricePerUnit,
                        returnedQuantity: line.returnedQuantity,
                        saleDate: line.saleDate,
                      })
                    }
                    style={({ pressed }) => [
                      styles.returnKey,
                      { borderColor: colors.lineStrong, backgroundColor: pressed ? colors.surfaceSunk : colors.surface },
                      { boxShadow: keyShadow(colors, 'paper', pressed), ...keyTravel(pressed) },
                    ]}
                  >
                    <Text style={[styles.returnLabel, { color: colors.ink }]}>{t.mySales.return}</Text>
                  </Pressable>
                ) : (
                  <Text style={[styles.time, { color: colors.steel }]}>{t.mySales.returned}</Text>
                )}
              </View>
            );
          })}
          {/* The sale's invoice, to print again or send as a PDF. */}
          {checkout.invoice && canPrint && (
            <View style={styles.invoice}>
              <Button label={t.mySales.printInvoice(checkout.invoice.number)} variant="quiet" onPress={() => print.mutate(checkout.invoice!)} loading={print.isPending} />
              {print.isError && (
                <Text style={[styles.time, { color: colors.signalOut }]} accessibilityLiveRegion="polite">
                  {print.error.message === 'blocked' ? t.sell.printBlocked : errorMessage(print.error)}
                </Text>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  panel: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1, gap: spacing.xs },
  title: { fontFamily: fonts.bodyBold, fontSize: type.title },
  hero: { fontFamily: fonts.bodyBold, fontSize: type.figureLarge, marginTop: spacing.xs, fontVariant: ['tabular-nums'] },
  muted: { fontFamily: fonts.body, fontSize: type.body },
  list: { borderRadius: radius.panel, borderWidth: 1, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  headText: { flex: 1, gap: 2 },
  time: { fontFamily: fonts.body, fontSize: type.label, fontVariant: ['tabular-nums'] },
  summary: { fontFamily: fonts.body, fontSize: type.body },
  amount: { fontFamily: fonts.bodyBold, fontSize: type.body, fontVariant: ['tabular-nums'] },
  caretOpen: { transform: [{ rotate: '180deg' }] },
  lines: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingVertical: spacing.xs },
  returnKey: { minHeight: 36, paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: radius.small, justifyContent: 'center' },
  returnLabel: { fontFamily: fonts.bodyBold, fontSize: type.label },
  invoice: { gap: spacing.xs, paddingTop: spacing.sm },
});

/** Today and yesterday in the phone's own timezone. */
export function dayRanges(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    startDate: today.toISOString(),
    endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString(),
    previousStartDate: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString(),
    previousEndDate: today.toISOString(),
  };
}
