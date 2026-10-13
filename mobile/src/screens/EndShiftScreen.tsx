import { CaretRight } from 'phosphor-react-native/src/icons/CaretRight';
import { Check } from 'phosphor-react-native/src/icons/Check';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { dayRanges, MY_SALES_QUERY_KEY } from '../components/MySales';
import { Button, ErrorState, Loading } from '../components/ui';
import type { Catalogue } from '../i18n/en';
import { useT } from '../i18n/useT';
import type { RootStackParamList } from '../navigation/types';
import { dayApi, reportsApi } from '../services/api';
import { useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, useThemeColors, type } from '../theme';
import { formatMoney } from '../utils/format';
import { DAY_QUERY_KEY, type ShiftStep, shiftSteps } from '../utils/shift';

type Props = NativeStackScreenProps<RootStackParamList, 'EndShift'>;

/** "Count the shop drawer", "Enter the carwash takings (Fushë)": named only when there are several carwashes. */
function stepLabel(step: ShiftStep, several: boolean, t: Catalogue): string {
  if (step.kind === 'drawer') {
    return step.place === 'shop' ? t.shift.countShop : t.shift.countCarwash(several ? step.name : null);
  }
  return t.shift.enterTakings(several ? step.name : null);
}

/**
 * Closing up, one step at a time: count each drawer (blind, as always), enter
 * the carwash takings, then you're done. The steps come from the server, the
 * same ones the dashboard's Day page shows. Each step still to do opens its
 * own screen and comes back here, so the list ticks itself off.
 */
export function EndShiftScreen({ navigation }: Props) {
  const colors = useThemeColors();
  const t = useT();
  const user = useCurrentUser();
  // Fixed once per visit so the query key doesn't change on every render.
  const [day] = useState(() => dayRanges());
  const today = useQuery({ queryKey: DAY_QUERY_KEY, queryFn: dayApi.today });
  const sales = useQuery({ queryKey: [...MY_SALES_QUERY_KEY, day.startDate], queryFn: () => reportsApi.mySales(day) });

  if (today.isPending) return <Loading />;
  if (today.isError) return <ErrorState error={today.error} onRetry={() => today.refetch()} />;

  const { steps, done, total, next } = shiftSteps(today.data);
  const several = steps.filter((step) => step.kind === 'carwash').length > 1;
  const firstName = user.name.split(' ')[0] ?? user.name;

  function open(step: ShiftStep) {
    if (step.kind === 'drawer') navigation.navigate('CashCount', { drawer: step.key });
    else navigation.navigate('Carwash', { carwashId: step.carwashId });
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header" accessibilityLiveRegion="polite">
        {next ? t.shift.stepsLeft(total - done) : t.shift.allDone(firstName)}
      </Text>
      {sales.data && (
        <Text style={[styles.lead, { color: colors.inkMuted }]}>
          {sales.data.current.salesCount > 0
            ? t.shift.yourDay(formatMoney(sales.data.current.revenue), sales.data.current.salesCount)
            : t.shift.noSales}
        </Text>
      )}

      <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
        {steps.map((step, index) => {
          const label = stepLabel(step, several, t);
          return (
            <Pressable
              key={step.key}
              // Status, not a checkbox: a step that is done stays done; one to do opens its screen.
              disabled={step.done}
              accessibilityRole="button"
              accessibilityState={{ disabled: step.done }}
              accessibilityLabel={`${label}. ${step.done ? t.shift.done : t.shift.toDo}`}
              onPress={() => open(step)}
              style={({ pressed }) => [
                styles.row,
                index > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
                pressed && { backgroundColor: colors.surfaceSunk },
              ]}
            >
              <View style={styles.rowText}>
                {/* A tick box like on paper, as on the dashboard: an empty ring to do, a filled tick once done. */}
                <View
                  style={[
                    styles.mark,
                    step.done
                      ? { backgroundColor: colors.ok, borderColor: colors.ok }
                      : { backgroundColor: colors.surfaceSunk, borderColor: colors.lineStrong, boxShadow: colors.inset },
                  ]}
                >
                  {step.done && <Check size={12} weight="bold" color={colors.surface} />}
                </View>
                <Text style={[styles.rowName, { color: step.done ? colors.inkMuted : colors.ink }]}>{label}</Text>
              </View>
              {!step.done && <CaretRight size={18} color={colors.inkMuted} />}
            </Pressable>
          );
        })}
      </View>

      {next ? (
        <Button label={stepLabel(next, several, t)} onPress={() => open(next)} />
      ) : (
        <Button label={t.shift.backHome} onPress={() => navigation.goBack()} />
      )}
      <Text style={[styles.hint, { color: colors.inkMuted }]}>{t.shift.expensesHint}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  title: { fontFamily: fonts.display, fontSize: type.headline, lineHeight: 34 },
  lead: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, marginTop: -spacing.sm },
  list: { borderWidth: 1, borderRadius: radius.panel, paddingHorizontal: spacing.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: spacing.sm },
  // Long place names wrap onto their own lines, next to the tick.
  rowText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mark: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  rowName: { flex: 1, fontFamily: fonts.body, fontSize: type.body, lineHeight: 22 },
  hint: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 21 },
});
