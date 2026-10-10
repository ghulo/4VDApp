import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { useT } from '../i18n/useT';
import { expiryApi } from '../services/api';
import { fonts, radius, spacing, useThemeColors, type } from '../theme';
import { toTypedDay } from '../utils/expiryDay';
import { errorMessage } from '../utils/format';
import { Button, Loading } from './ui';

/** Same as the dashboard and server: warnings start a week ahead, urgent in the last two days. */
const WARNING_DAYS = 7;
const URGENT_DAYS = 2;

/** The expiry dates noted for a product, with "dealt with" and a way to add one. Staff only. */
export function ExpiryPanel({ productId, onAdd }: { productId: number; onAdd: () => void }) {
  const t = useT();
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const dates = useQuery({ queryKey: ['expiry', productId], queryFn: () => expiryApi.forProduct(productId) });
  const clear = useMutation({
    mutationFn: expiryApi.clear,
    onSuccess: () => {
      for (const key of [['expiry'], ['reports'], ['activity']]) queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
      <Text style={[styles.title, { color: colors.ink }]}>{t.expiry.title}</Text>
      {dates.isPending && <Loading />}
      {dates.isError && <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(dates.error)}</Text>}
      {dates.data?.length === 0 && <Text style={[styles.muted, { color: colors.steel }]}>{t.expiry.none}</Text>}
      {dates.data?.map((row) => {
        const tone = row.daysLeft <= URGENT_DAYS ? colors.signalOut : row.daysLeft <= WARNING_DAYS ? colors.signalLow : colors.steel;
        return (
          <View key={row.id} style={[styles.row, { borderTopColor: colors.line }]}>
            <View style={styles.rowText}>
              <Text style={[styles.rowMain, { color: colors.ink }]}>
                {t.expiry.units(row.remaining)} · {toTypedDay(row.expiresOn)}
              </Text>
              <Text style={[styles.rowLeft, { color: tone }]}>{t.expiry.left(row.daysLeft)}</Text>
              {row.note && <Text style={[styles.muted, { color: colors.steel }]}>{row.note}</Text>}
            </View>
            <Button label={t.expiry.dealtWith} variant="quiet" onPress={() => clear.mutate(row.id)} disabled={clear.isPending} />
          </View>
        );
      })}
      {clear.isError && <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(clear.error)}</Text>}
      <Button label={t.expiry.noteIt} variant="quiet" onPress={onAdd} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1, gap: spacing.sm },
  title: { fontFamily: fonts.bodyBold, fontSize: type.title, marginBottom: spacing.xs },
  muted: { fontFamily: fonts.body, fontSize: type.label },
  error: { fontFamily: fonts.bodyBold, fontSize: type.label },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1 },
  rowText: { flex: 1, gap: 2 },
  rowMain: { fontFamily: fonts.bodyBold, fontSize: type.body },
  rowLeft: { fontFamily: fonts.bodyBold, fontSize: type.label },
});
