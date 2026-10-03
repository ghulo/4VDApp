import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RootStackParamList } from '../navigation/types';
import { reportsApi } from '../services/api';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage, formatMoney } from '../utils/format';
import { useT } from '../i18n/useT';


/**
 * This calendar month and last calendar month, in the phone's own timezone.
 * Last month is sent explicitly so "Last month" really means last month,
 * not "the same number of days before the 1st".
 */
export function monthRanges(now = new Date(), locale = 'en-GB') {
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  return {
    startDate: start.toISOString(),
    endDate: new Date(year, month + 1, 1).toISOString(),
    previousStartDate: new Date(year, month - 1, 1).toISOString(),
    previousEndDate: start.toISOString(),
    name: new Intl.DateTimeFormat(locale, { month: 'long' }).format(start),
  };
}

export const MY_SALES_QUERY_KEY = ['reports', 'my-sales'];

export function MySales() {
  const colors = useThemeColors();
  const t = useT();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const month = monthRanges(new Date(), t.dateLocale);
  const shortDate = new Intl.DateTimeFormat(t.dateLocale, { day: 'numeric', month: 'short' });
  const mySales = useQuery({
    queryKey: [...MY_SALES_QUERY_KEY, month.startDate],
    queryFn: () => reportsApi.mySales(month),
  });

  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <Text style={[styles.title, { color: colors.ink }]}>{t.mySales.title(month.name)}</Text>
      {mySales.isPending && <Text style={[styles.muted, { color: colors.steel }]}>{t.mySales.loading}</Text>}
      {mySales.isError && <Text style={[styles.muted, { color: colors.signalOut }]}>{errorMessage(mySales.error)}</Text>}
      {mySales.data && (
        <>
          <Text style={[styles.hero, { color: colors.ink }]}>{formatMoney(mySales.data.current.revenue)}</Text>
          <Text style={[styles.muted, { color: colors.steel }]}>
            {t.mySales.summary({
              sales: mySales.data.current.salesCount,
              units: mySales.data.current.unitsSold,
              refunds: mySales.data.current.refunds > 0 ? formatMoney(mySales.data.current.refunds) : null,
              lastMonth: formatMoney(mySales.data.previous.revenue),
            })}
          </Text>
          {mySales.data.recentSales.length > 0 ? (
            <View style={styles.list}>
              {mySales.data.recentSales.map((sale) => (
                <View key={sale.id} style={[styles.row, { borderTopColor: colors.line }]}>
                  <Text style={[styles.rowText, { color: colors.ink }]} numberOfLines={1}>
                    {sale.quantity} × {sale.productName}
                  </Text>
                  <Text style={[styles.rowAmount, { color: colors.ink }]}>{formatMoney(sale.totalAmount)}</Text>
                  <Text style={[styles.rowDate, { color: colors.steel }]}>{shortDate.format(new Date(sale.saleDate))}</Text>
                  {sale.returnedQuantity < sale.quantity ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t.mySales.returnLabel(sale.productName)}
                      hitSlop={8}
                      onPress={() =>
                        navigation.navigate('Return', {
                          saleId: sale.id,
                          productName: sale.productName,
                          quantity: sale.quantity,
                          pricePerUnit: sale.pricePerUnit,
                          returnedQuantity: sale.returnedQuantity,
                          saleDate: sale.saleDate,
                        })
                      }
                    >
                      <Text style={[styles.rowAction, { color: colors.ink }]}>{t.mySales.return}</Text>
                    </Pressable>
                  ) : (
                    <Text style={[styles.rowAction, { color: colors.steel }]}>{t.mySales.returned}</Text>
                  )}
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.muted, { color: colors.steel }]}>{t.mySales.none}</Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1, gap: spacing.xs },
  title: { fontFamily: fonts.display, fontSize: 20 },
  hero: { fontFamily: fonts.bodyBold, fontSize: 36, marginTop: spacing.xs },
  muted: { fontFamily: fonts.body, fontSize: 15 },
  list: { marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1 },
  rowText: { flex: 1, fontFamily: fonts.body, fontSize: 15 },
  rowAmount: { fontFamily: fonts.bodyBold, fontSize: 15, fontVariant: ['tabular-nums'] },
  rowDate: { fontFamily: fonts.body, fontSize: 13, minWidth: 48, textAlign: 'right' },
  rowAction: { fontFamily: fonts.bodyBold, fontSize: 14, textDecorationLine: 'underline' },
});
