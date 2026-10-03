import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretRight } from 'phosphor-react-native/src/icons/CaretRight';
import { ClipboardText } from 'phosphor-react-native/src/icons/ClipboardText';
import { Receipt } from 'phosphor-react-native/src/icons/Receipt';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/ui';
import { WelcomeTour } from '../components/WelcomeTour';
import { monthRanges, MY_SALES_QUERY_KEY } from '../components/MySales';
import type { RootStackParamList } from '../navigation/types';
import { approvalsApi, countsApi, inventoryApi, reportsApi } from '../services/api';
import type { MyRequest } from '../services/types';
import { canRecordSales, useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, type ThemeColors, useThemeColors } from '../theme';
import { formatDateWith, formatMoney } from '../utils/format';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';

const LOW_STOCK_SHOWN = 5;
const RECENT_SALES_SHOWN = 3;
/** Decided requests stay on Home this long, so a rejection reason isn't missed. */
const DECIDED_SHOWN_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function greeting(t: Catalogue, now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return t.home.morning;
  if (hour < 18) return t.home.afternoon;
  return t.home.evening;
}

/** Today and yesterday in the phone's own timezone. */
function dayRanges(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    startDate: today.toISOString(),
    endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString(),
    previousStartDate: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString(),
    previousEndDate: today.toISOString(),
  };
}

export function HomeScreen() {
  const colors = useThemeColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const user = useCurrentUser();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const sells = canRecordSales(user);
  const now = new Date();

  const day = dayRanges(now);
  const month = monthRanges(now);
  const longDate = { format: (date: Date) => formatDateWith(date, { weekday: 'long', day: 'numeric', month: 'long' }) };
  const today = useQuery({
    queryKey: [...MY_SALES_QUERY_KEY, day.startDate],
    queryFn: () => reportsApi.mySales(day),
    enabled: sells,
  });
  const thisMonth = useQuery({
    queryKey: [...MY_SALES_QUERY_KEY, month.startDate],
    queryFn: () => reportsApi.mySales(month),
    enabled: sells,
  });
  const counts = useQuery({ queryKey: ['stock-counts'], queryFn: countsApi.list, enabled: sells });
  const requests = useQuery({ queryKey: ['approvals', 'mine'], queryFn: approvalsApi.mine, enabled: sells });
  const lowStock = useQuery({ queryKey: ['inventory', 'low', LOW_STOCK_SHOWN], queryFn: () => inventoryApi.lowStock(LOW_STOCK_SHOWN) });

  async function refresh() {
    setIsRefreshing(true);
    await Promise.all(
      [MY_SALES_QUERY_KEY, ['products'], ['favorites'], ['inventory'], ['stock-counts'], ['approvals']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
    setIsRefreshing(false);
  }

  function openSearch() {
    navigation.navigate('Main', { screen: 'Catalog', params: { search: search.trim() } });
    setSearch('');
  }

  const firstName = user.name.split(' ')[0];
  const openCounts = counts.data?.filter((count) => count.status === 'open').length ?? 0;
  const visibleRequests = (requests.data ?? []).filter(
    (request) =>
      request.status === 'pending' ||
      request.status === 'submitted' ||
      (request.decidedAt !== null && now.getTime() - new Date(request.decidedAt).getTime() < DECIDED_SHOWN_DAYS * MS_PER_DAY),
  );
  const recentSales = thisMonth.data?.recentSales.slice(0, RECENT_SALES_SHOWN) ?? [];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
      keyboardShouldPersistTaps="handled"
    >
      <WelcomeTour user={user} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.greetingText}>
          <Text style={[styles.greeting, { color: colors.ink }]} accessibilityRole="header">
            {t.home.greeting(greeting(t, now), firstName ?? user.name)}
          </Text>
          <Text style={[styles.date, { color: colors.inkMuted }]}>{longDate.format(now)}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.home.yourAccount}
          onPress={() => navigation.navigate('Main', { screen: 'Account' })}
          hitSlop={8}
        >
          <Avatar name={user.name} url={user.avatarUrl} size={44} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {sells && (
          <View style={[styles.today, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <Text style={[styles.todayHeadline, { color: colors.ink }]} accessibilityLiveRegion="polite">
              {today.data
                ? today.data.current.salesCount > 0
                  ? t.home.takenToday(formatMoney(today.data.current.revenue), today.data.current.salesCount)
                  : t.home.noSalesToday
                : today.isError
                  ? t.home.notAvailable
                  : '…'}
            </Text>
            {thisMonth.data && (
              <Text style={[styles.todayDetail, { color: colors.inkMuted }]}>
                {t.home.monthSoFar(formatMoney(thisMonth.data.current.revenue), month.name)}
              </Text>
            )}
            {thisMonth.data?.monthlyTarget ? (
              <TargetBar
                colors={colors}
                revenue={thisMonth.data.current.revenue}
                target={thisMonth.data.monthlyTarget}
                monthName={month.name}
              />
            ) : null}
            <View style={styles.todayAction}>
              <Button label={t.home.recordSale} onPress={() => navigation.navigate('RecordSale', {})} />
            </View>
          </View>
        )}

        <TextInput
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={openSearch}
          placeholder={t.home.searchPlaceholder}
          placeholderTextColor={colors.steel}
          accessibilityLabel={t.home.searchLabel}
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.search, { color: colors.ink, borderColor: colors.lineStrong, backgroundColor: colors.surface }]}
        />

        {sells && (
          <View style={[styles.jobs, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <JobRow
              colors={colors}
              icon={Receipt}
              title={t.home.mySales}
              detail={thisMonth.data ? t.home.salesIn(t.home.sales(thisMonth.data.current.salesCount), month.name) : month.name}
              onPress={() => navigation.navigate('MySales')}
            />
            <JobRow
              colors={colors}
              icon={ClipboardText}
              title={t.home.stockCount}
              detail={openCounts > 0 ? t.home.countsOpen(openCounts) : t.home.startCount}
              onPress={() => navigation.navigate('Counts')}
              last
            />
          </View>
        )}

        {sells && visibleRequests.length > 0 && (
          <Section title={t.home.yourRequests} colors={colors}>
            {visibleRequests.map((request) => (
              <RequestRow key={`${request.type}-${request.id}`} request={request} colors={colors} />
            ))}
          </Section>
        )}

        <Section title={t.home.runningLow} colors={colors}>
          {lowStock.isPending && <Muted colors={colors}>{t.home.checkingStock}</Muted>}
          {lowStock.isError && <Muted colors={colors}>{t.home.stockFailed}</Muted>}
          {lowStock.data?.items.length === 0 && <Muted colors={colors}>{t.home.wellStocked}</Muted>}
          {lowStock.data?.items.map((item) => {
            const isOut = item.quantity === 0;
            return (
              <Pressable
                key={item.productId}
                accessibilityRole="button"
                accessibilityLabel={`${item.productName}, ${isOut ? t.home.soldOut : t.home.left(item.quantity)}`}
                onPress={() => navigation.navigate('ProductDetail', { productId: item.productId, name: item.productName })}
                style={({ pressed }) => [styles.row, { borderTopColor: colors.line }, pressed && styles.pressed]}
              >
                <View style={[styles.signal, { backgroundColor: isOut ? colors.signalOut : colors.signalLow }]} />
                <Text style={[styles.rowName, { color: colors.ink }]} numberOfLines={1}>
                  {item.productName}
                </Text>
                <Text style={[styles.rowValue, { color: isOut ? colors.signalOut : colors.ink }]}>
                  {isOut ? t.home.soldOut : t.home.left(item.quantity)}
                </Text>
              </Pressable>
            );
          })}
          {lowStock.data && lowStock.data.meta.total > lowStock.data.items.length && (
            <Muted colors={colors}>
              {t.home.andMore(lowStock.data.meta.total - lowStock.data.items.length)}
            </Muted>
          )}
        </Section>

        {sells && (
          <Section title={t.home.latestSales} colors={colors}>
            {thisMonth.data && recentSales.length === 0 && (
              <Muted colors={colors}>{t.home.noSalesYet}</Muted>
            )}
            {recentSales.map((sale) => (
              <View key={sale.id} style={[styles.row, { borderTopColor: colors.line }]}>
                <Text style={[styles.rowName, { color: colors.ink }]} numberOfLines={1}>
                  {sale.quantity} × {sale.productName}
                </Text>
                <Text style={[styles.rowValue, { color: colors.ink }]}>{formatMoney(sale.totalAmount)}</Text>
                <Text style={[styles.rowTime, { color: colors.steel }]}>{saleTime(sale.saleDate, now)}</Text>
              </View>
            ))}
          </Section>
        )}
      </View>
    </ScrollView>
  );
}

/** Progress towards the monthly target the owner set; full once it is reached. */
function TargetBar({ colors, revenue, target, monthName }: { colors: ThemeColors; revenue: number; target: number; monthName: string }) {
  const t = useT();
  const share = Math.min(Math.max(revenue / target, 0), 1);
  const reached = revenue >= target;
  const label = reached
    ? t.home.targetReached(formatMoney(target), monthName)
    : t.home.targetToGo({ left: formatMoney(target - revenue), month: monthName, target: formatMoney(target) });
  return (
    <View
      style={styles.target}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}
    >
      <View style={[styles.targetTrack, { backgroundColor: colors.fill }]}>
        <View style={[styles.targetFill, { width: `${share * 100}%`, backgroundColor: reached ? colors.ok : colors.ink }]} />
      </View>
      <Text style={[styles.todayDetail, { color: colors.inkMuted }]}>{label}</Text>
    </View>
  );
}

function RequestRow({ request, colors }: { request: MyRequest; colors: ThemeColors }) {
  const t = useT();
  // Undone reads like a rejection: it didn't count, and the reason follows.
  const isRejected = request.status === 'rejected' || request.status === 'undone';
  const isWaiting = request.status === 'pending' || request.status === 'submitted';
  return (
    <View style={[styles.requestRow, { borderTopColor: colors.line }]}>
      <Text style={[styles.rowName, { color: colors.ink }]}>{request.summary}</Text>
      <Text style={[styles.requestStatus, { color: isRejected ? colors.signalOut : isWaiting ? colors.signalLowInk : colors.stockOk }]}>
        {t.home.requestStatus[request.status] ?? request.status}
        {isRejected && request.decisionNote ? `: ${request.decisionNote}` : ''}
      </Text>
    </View>
  );
}

/** "10:42" for today, "28 Sep" for earlier days. */
function saleTime(iso: string, now: Date): string {
  const date = new Date(iso);
  return date.toDateString() === now.toDateString()
    ? formatDateWith(date, { hour: '2-digit', minute: '2-digit' })
    : formatDateWith(date, { day: 'numeric', month: 'short' });
}

interface JobRowProps {
  colors: ThemeColors;
  icon: typeof Receipt;
  title: string;
  detail: string;
  onPress: () => void;
  last?: boolean;
}

/** A job the bottom tabs don't cover, as a full-width row that's easy to hit. */
function JobRow({ colors, icon: Icon, title, detail, onPress, last }: JobRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.job,
        !last && { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth },
        pressed && { backgroundColor: colors.surfaceSunk },
      ]}
    >
      <Icon size={24} color={colors.ink} />
      <View style={styles.jobText}>
        <Text style={[styles.jobTitle, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.jobDetail, { color: colors.steel }]} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <CaretRight size={18} color={colors.inkMuted} />
    </Pressable>
  );
}

function Section({ title, colors, children }: { title: string; colors: ThemeColors; children: ReactNode }) {
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <Text style={[styles.sectionTitle, { color: colors.ink }]} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Muted({ colors, children }: { colors: ThemeColors; children: ReactNode }) {
  return <Text style={[styles.muted, { color: colors.steel }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  greetingText: { flex: 1, gap: 2 },
  greeting: { fontFamily: fonts.serif, fontSize: 30, lineHeight: 36 },
  date: { fontFamily: fonts.body, fontSize: 16 },
  pressed: { opacity: 0.8 },
  body: { padding: spacing.lg, gap: spacing.lg },
  // The day in a sentence on plain paper; the one orange thing is the sale button.
  today: { padding: spacing.xl, gap: spacing.xs, borderWidth: 1, borderRadius: radius.panel },
  todayHeadline: { fontFamily: fonts.serif, fontSize: 28, lineHeight: 34 },
  todayDetail: { fontFamily: fonts.body, fontSize: 15 },
  todayAction: { marginTop: spacing.lg },
  target: { marginTop: spacing.md, gap: spacing.xs },
  targetTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  targetFill: { height: 8, borderRadius: 4 },
  search: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.small,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  jobs: { borderWidth: 1, borderRadius: radius.panel, overflow: 'hidden' },
  job: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, paddingHorizontal: spacing.lg },
  jobText: { flex: 1, gap: 2 },
  jobTitle: { fontFamily: fonts.bodyBold, fontSize: 17 },
  jobDetail: { fontFamily: fonts.body, fontSize: 14 },
  section: { borderWidth: 1, borderRadius: radius.panel, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: 18, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  signal: { width: 4, alignSelf: 'stretch', marginVertical: spacing.sm, borderRadius: 2 },
  rowName: { flex: 1, fontFamily: fonts.body, fontSize: 16 },
  rowValue: { fontFamily: fonts.bodyBold, fontSize: 16, fontVariant: ['tabular-nums'] },
  rowTime: { width: 52, textAlign: 'right', fontFamily: fonts.body, fontSize: 14, fontVariant: ['tabular-nums'] },
  muted: { fontFamily: fonts.body, fontSize: 15, paddingVertical: spacing.sm },
  requestRow: { paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, gap: 2 },
  requestStatus: { fontFamily: fonts.bodyBold, fontSize: 14 },
});
