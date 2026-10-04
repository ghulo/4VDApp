import { ClipboardText } from 'phosphor-react-native/src/icons/ClipboardText';
import { Coins } from 'phosphor-react-native/src/icons/Coins';
import { Drop } from 'phosphor-react-native/src/icons/Drop';
import { Notebook } from 'phosphor-react-native/src/icons/Notebook';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { LogoMark } from '../components/LogoMark';
import { BlockMeter, DoubleRule, IconChip, Kicker, PrintSection, ShopSunrise } from '../components/print';
import { Button } from '../components/ui';
import { WelcomeTour } from '../components/WelcomeTour';
import { monthRanges, MY_SALES_QUERY_KEY } from '../components/MySales';
import type { RootStackParamList } from '../navigation/types';
import { approvalsApi, carwashApi, cashApi, countsApi, customersApi, inventoryApi, reportsApi } from '../services/api';
import type { MyRequest } from '../services/types';
import { canRecordSales, useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, type ThemeColors, useThemeColors } from '../theme';
import { formatDateWith, formatMoney } from '../utils/format';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';
import { TabBarSpacer } from '../components/TabBarSpace';

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
  const cash = useQuery({ queryKey: ['cash', 'today'], queryFn: cashApi.today, enabled: sells });
  const tabs = useQuery({ queryKey: ['customers'], queryFn: customersApi.list, enabled: sells });
  const owing = tabs.data?.filter((customer) => customer.balance > 0) ?? [];
  const carwash = useQuery({ queryKey: ['carwash', 'today'], queryFn: carwashApi.today, enabled: sells });
  const requests = useQuery({ queryKey: ['approvals', 'mine'], queryFn: approvalsApi.mine, enabled: sells });
  const lowStock = useQuery({ queryKey: ['inventory', 'low', LOW_STOCK_SHOWN], queryFn: () => inventoryApi.lowStock(LOW_STOCK_SHOWN) });

  async function refresh() {
    setIsRefreshing(true);
    await Promise.all(
      [MY_SALES_QUERY_KEY, ['products'], ['favorites'], ['inventory'], ['stock-counts'], ['approvals'], ['cash'], ['customers'], ['carwash']].map((queryKey) =>
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

      {/* The masthead: mark, date and you, over a newspaper double rule. */}
      <View style={[styles.masthead, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.mastheadRow}>
          <LogoMark size={28} />
          <View style={styles.date}>
            <Kicker>{longDate.format(now)}</Kicker>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.home.yourAccount}
            onPress={() => navigation.navigate('Main', { screen: 'Account' })}
            hitSlop={8}
          >
            <Avatar name={user.name} url={user.avatarUrl} size={40} />
          </Pressable>
        </View>
        <DoubleRule />
        <Text style={[styles.greeting, { color: colors.ink }]} accessibilityRole="header">
          {t.home.greeting(greeting(t, now), firstName ?? user.name)}
        </Text>
      </View>

      <View style={styles.body}>
        {sells && (
          <View style={[styles.today, { backgroundColor: colors.fill, boxShadow: colors.raise }]}>
            <View style={styles.todayArt}>
              <ShopSunrise />
            </View>
            <View style={styles.todayText}>
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
              <View style={styles.todayActions}>
                <Button label={t.home.recordSale} onPress={() => navigation.navigate('RecordSale', {})} />
                <Button
                  variant="quiet"
                  label={
                    thisMonth.data
                      ? `${t.home.mySales} · ${t.home.salesIn(t.home.sales(thisMonth.data.current.salesCount), month.name)}`
                      : t.home.mySales
                  }
                  onPress={() => navigation.navigate('MySales')}
                />
              </View>
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
          style={[styles.search, { color: colors.ink, borderColor: colors.lineStrong, backgroundColor: colors.surface, boxShadow: colors.inset }]}
        />

        {sells && (
          <View style={styles.jobs}>
            <JobTile
              colors={colors}
              icon={ClipboardText}
              title={t.home.stockCount}
              detail={openCounts > 0 ? t.home.countsOpen(openCounts) : t.home.startCount}
              onPress={() => navigation.navigate('Counts')}
            />
            <JobTile
              colors={colors}
              icon={Coins}
              title={t.home.closeDrawer}
              detail={cash.data?.find((entry) => entry.place === 'shop')?.countedAt ? t.home.drawerCounted : t.home.drawerToCount}
              onPress={() => navigation.navigate('CashCount')}
            />
            <JobTile
              colors={colors}
              icon={Notebook}
              title={t.home.tabs}
              detail={
                owing.length > 0
                  ? t.home.tabsOwed(formatMoney(owing.reduce((sum, customer) => sum + customer.balance, 0)), owing.length)
                  : t.home.tabsNone
              }
              onPress={() => navigation.navigate('Tabs')}
            />
            <JobTile
              colors={colors}
              icon={Drop}
              title={t.home.carwash}
              detail={carwash.data?.takings ? t.home.carwashDone : t.home.carwashToDo}
              onPress={() => navigation.navigate('Carwash')}
            />
          </View>
        )}

        {sells && visibleRequests.length > 0 && (
          <PrintSection title={t.home.yourRequests}>
            {visibleRequests.map((request, index) => (
              <RequestRow key={`${request.type}-${request.id}`} request={request} colors={colors} first={index === 0} />
            ))}
          </PrintSection>
        )}

        <PrintSection title={t.home.runningLow}>
          {lowStock.isPending && <Muted colors={colors}>{t.home.checkingStock}</Muted>}
          {lowStock.isError && <Muted colors={colors}>{t.home.stockFailed}</Muted>}
          {lowStock.data?.items.length === 0 && <Muted colors={colors}>{t.home.wellStocked}</Muted>}
          {lowStock.data?.items.map((item, index) => {
            const isOut = item.quantity === 0;
            return (
              <Pressable
                key={item.productId}
                accessibilityRole="button"
                accessibilityLabel={`${item.productName}, ${isOut ? t.home.soldOut : t.home.left(item.quantity)}`}
                onPress={() => navigation.navigate('ProductDetail', { productId: item.productId, name: item.productName })}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
                  pressed && { backgroundColor: colors.surfaceSunk },
                ]}
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
            <Muted colors={colors}>{t.home.andMore(lowStock.data.meta.total - lowStock.data.items.length)}</Muted>
          )}
        </PrintSection>

        {sells && (
          <PrintSection title={t.home.latestSales}>
            {thisMonth.data && recentSales.length === 0 && <Muted colors={colors}>{t.home.noSalesYet}</Muted>}
            {recentSales.map((sale, index) => (
              <View
                key={sale.id}
                style={[styles.row, index > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}
              >
                <Text style={[styles.rowName, { color: colors.ink }]} numberOfLines={1}>
                  {sale.quantity} × {sale.productName}
                </Text>
                <Text style={[styles.rowValue, { color: colors.ink }]}>{formatMoney(sale.totalAmount)}</Text>
                <Text style={[styles.rowTime, { color: colors.steel }]}>{saleTime(sale.saleDate, now)}</Text>
              </View>
            ))}
          </PrintSection>
        )}
      </View>
      <TabBarSpacer />
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
      <BlockMeter share={share} done={reached} track={colors.surface} />
      <Text style={[styles.todayDetail, { color: colors.inkMuted }]}>{label}</Text>
    </View>
  );
}

function RequestRow({ request, colors, first }: { request: MyRequest; colors: ThemeColors; first: boolean }) {
  const t = useT();
  // Undone reads like a rejection: it didn't count, and the reason follows.
  const isRejected = request.status === 'rejected' || request.status === 'undone';
  const isWaiting = request.status === 'pending' || request.status === 'submitted';
  return (
    <View style={[styles.requestRow, !first && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
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

interface JobTileProps {
  colors: ThemeColors;
  icon: Parameters<typeof IconChip>[0]['icon'];
  title: string;
  detail: string;
  onPress: () => void;
}

/** A job the bottom tabs don't cover, as an oat tile with its icon. */
function JobTile({ colors, icon, title, detail, onPress }: JobTileProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: colors.fill },
        pressed && styles.pressed,
      ]}
    >
      <IconChip icon={icon} background={colors.surface} />
      <Text style={[styles.tileTitle, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.tileDetail, { color: colors.steel }]} numberOfLines={2}>
        {detail}
      </Text>
    </Pressable>
  );
}

function Muted({ colors, children }: { colors: ThemeColors; children: ReactNode }) {
  return <Text style={[styles.muted, { color: colors.steel }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxl },
  masthead: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  mastheadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  date: { flex: 1 },
  pressed: { opacity: 0.75 },
  greeting: { fontFamily: fonts.serif, fontSize: 32, lineHeight: 38, marginTop: spacing.sm },
  body: { padding: spacing.lg, gap: spacing.xl },
  // The day on an oat panel under the shop at sunrise; the sale button is clay.
  today: { borderRadius: radius.panel, overflow: 'hidden', padding: spacing.xl, paddingBottom: 0 },
  todayArt: { width: '100%', maxWidth: 280, alignSelf: 'center' },
  todayText: { paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xs },
  todayHeadline: { fontFamily: fonts.serif, fontSize: 28, lineHeight: 34 },
  todayDetail: { fontFamily: fonts.body, fontSize: 15 },
  todayActions: { marginTop: spacing.lg, gap: spacing.sm },
  target: { marginTop: spacing.md, gap: spacing.sm },
  search: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.small,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  jobs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 132,
    padding: spacing.lg,
    gap: spacing.xs,
    borderRadius: radius.panel,
  },
  tileTitle: { fontFamily: fonts.bodyBold, fontSize: 17, marginTop: spacing.sm },
  tileDetail: { fontFamily: fonts.body, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  // Stock state as a small printed square; the words beside it carry the meaning.
  signal: { width: 8, height: 8 },
  rowName: { flex: 1, fontFamily: fonts.body, fontSize: 16 },
  rowValue: { fontFamily: fonts.bodyBold, fontSize: 16, fontVariant: ['tabular-nums'] },
  rowTime: { width: 52, textAlign: 'right', fontFamily: fonts.body, fontSize: 14, fontVariant: ['tabular-nums'] },
  muted: { fontFamily: fonts.body, fontSize: 15, paddingVertical: spacing.sm },
  requestRow: { paddingVertical: spacing.sm, gap: 2 },
  requestStatus: { fontFamily: fonts.bodyBold, fontSize: 14 },
});
