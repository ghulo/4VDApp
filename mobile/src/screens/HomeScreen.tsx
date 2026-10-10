import { ClipboardText } from 'phosphor-react-native/src/icons/ClipboardText';
import { Coins } from 'phosphor-react-native/src/icons/Coins';
import { Notebook } from 'phosphor-react-native/src/icons/Notebook';
import { Truck } from 'phosphor-react-native/src/icons/Truck';
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
import { dayRanges, monthRanges, MY_SALES_QUERY_KEY } from '../components/MySales';
import type { RootStackParamList } from '../navigation/types';
import { DELIVERIES_QUERY_KEY } from './DeliveriesScreen';
import { approvalsApi, attentionApi, countsApi, dayApi, customersApi, deliveriesApi, inventoryApi, reportsApi } from '../services/api';
import type { MyRequest, TodoItem } from '../services/types';
import { canRecordSales, useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, type ThemeColors, useThemeColors, type } from '../theme';
import { formatDateWith, formatMoney } from '../utils/format';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';
import { TabBarSpacer } from '../components/TabBarSpace';
import { DAY_QUERY_KEY, shiftSteps } from '../utils/shift';
import { CaretRight } from 'phosphor-react-native/src/icons/CaretRight';

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
  const closing = useQuery({ queryKey: DAY_QUERY_KEY, queryFn: dayApi.today, enabled: sells });
  const tabs = useQuery({ queryKey: ['customers'], queryFn: customersApi.list, enabled: sells });
  const owing = tabs.data?.filter((customer) => customer.balance > 0) ?? [];
  const requests = useQuery({ queryKey: ['approvals', 'mine'], queryFn: approvalsApi.mine, enabled: sells });
  const deliveries = useQuery({ queryKey: DELIVERIES_QUERY_KEY, queryFn: deliveriesApi.list, enabled: sells });
  const shift = shiftSteps(closing.data);
  // Only once the steps are in, so a slow network never says "closed up" by mistake.
  const shiftClosed = Boolean(closing.data) && shift.done === shift.total;
  // What needs this person, from the same list the dashboard's Inbox shows (DESIGN.md 3.3).
  const attention = useQuery({ queryKey: ['attention'], queryFn: attentionApi.get, refetchInterval: 60_000 });
  const todo = attention.data?.todo ?? [];
  const closingDue = todo.some((item) => item.verb === 'endShift' || item.verb === 'closeDay');
  const hasCarwash = shift.steps.some((step) => step.kind === 'carwash');
  const lowStock = useQuery({ queryKey: ['inventory', 'low', LOW_STOCK_SHOWN], queryFn: () => inventoryApi.lowStock(LOW_STOCK_SHOWN) });

  async function refresh() {
    setIsRefreshing(true);
    await Promise.all(
      [MY_SALES_QUERY_KEY, ['attention'], ['products'], ['favorites'], ['inventory'], ['stock-counts'], ['approvals'], ['cash'], ['customers'], ['carwash'], ['orders']].map((queryKey) =>
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
              {shiftClosed && <Text style={[styles.todayDetail, { color: colors.stockOk }]}>{t.home.closedUp}</Text>}
              <View style={styles.todayActions}>
                {/* What's next: selling all day; from closing time, ending the shift until it's done. */}
                {closingDue && !shiftClosed ? (
                  <>
                    <Button label={t.home.endShift} onPress={() => navigation.navigate('EndShift')} />
                    <Button variant="quiet" label={t.home.recordSale} onPress={() => navigation.navigate('RecordSale', {})} />
                  </>
                ) : (
                  <Button label={t.home.recordSale} onPress={() => navigation.navigate('RecordSale', {})} />
                )}
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

        {todo.length > 0 && (
          <PrintSection title={t.home.todo}>
            {todo.map((item, index) => (
              <TodoRow
                key={item.key}
                item={item}
                colors={colors}
                first={index === 0}
                onPress={item.verb === 'endShift' || item.verb === 'closeDay' ? () => navigation.navigate('EndShift') : undefined}
              />
            ))}
            {todo.some((item) => item.verb !== 'endShift' && item.verb !== 'closeDay') && <Muted colors={colors}>{t.home.onDashboard}</Muted>}
          </PrintSection>
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
          <PrintSection title={t.home.somethingHappened}>
            {/* Things that happen at the counter any time, so they never hide inside other screens. */}
            <HappenedRow first colors={colors} title={t.home.happened.returnSale} hint={t.home.happened.returnSaleHint} onPress={() => navigation.navigate('MySales')} />
            <HappenedRow
              colors={colors}
              title={t.home.happened.damage}
              hint={t.home.happened.damageHint}
              onPress={() => navigation.navigate('Main', { screen: 'Catalog', params: { then: 'writeOff' } })}
            />
            <HappenedRow
              colors={colors}
              title={t.home.happened.expiry}
              hint={t.home.happened.expiryHint}
              onPress={() => navigation.navigate('Main', { screen: 'Catalog', params: { then: 'expiry' } })}
            />
            {hasCarwash && (
              <HappenedRow colors={colors} title={t.home.happened.carwash} hint={t.home.happened.carwashHint} onPress={() => navigation.navigate('Carwash')} />
            )}
          </PrintSection>
        )}

        {sells && (
          <View style={styles.jobs}>
            <JobTile
              colors={colors}
              icon={Coins}
              title={t.home.endShift}
              detail={shift.total > 0 && shift.done === shift.total ? t.home.shiftDone : t.home.shiftSteps(shift.done, shift.total)}
              onPress={() => navigation.navigate('EndShift')}
            />
            <JobTile
              colors={colors}
              icon={ClipboardText}
              title={t.home.stockCount}
              detail={openCounts > 0 ? t.home.countsOpen(openCounts) : t.home.startCount}
              onPress={() => navigation.navigate('Counts')}
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
            {/* Only while something is on its way, so Home stays calm the rest of the time. */}
            {(deliveries.data?.length ?? 0) > 0 && (
              <JobTile
                colors={colors}
                icon={Truck}
                title={t.home.deliveries}
                detail={t.home.deliveriesWaiting(deliveries.data!.length)}
                onPress={() => navigation.navigate('Deliveries')}
              />
            )}
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

/** One To do item: its stamp, what it is and what to do; tappable when the team app can do it. */
function TodoRow({ item, colors, first, onPress }: { item: TodoItem; colors: ThemeColors; first: boolean; onPress?: () => void }) {
  const t = useT();
  const stamp = item.severity === 'urgent' ? colors.signalOut : item.severity === 'check' ? colors.signalLowInk : colors.inkMuted;
  return (
    <Pressable
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${t.home.severity[item.severity]}. ${item.title}. ${item.detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.happenedRow,
        !first && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
        pressed && { backgroundColor: colors.surfaceSunk },
      ]}
    >
      <View style={styles.happenedText}>
        <Text style={[styles.stamp, { color: stamp, borderColor: stamp }]}>{t.home.severity[item.severity]}</Text>
        <Text style={[styles.rowName, { color: colors.ink }]}>{item.title}</Text>
        <Text style={[styles.tileDetail, { color: colors.steel }]}>{item.detail}</Text>
      </View>
      {onPress && <CaretRight size={18} color={colors.inkMuted} />}
    </Pressable>
  );
}

/** One of the four things that can happen at the counter, opening where it gets reported. */
function HappenedRow({ colors, title, hint, onPress, first }: { colors: ThemeColors; title: string; hint: string; onPress: () => void; first?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${hint}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.happenedRow,
        !first && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
        pressed && { backgroundColor: colors.surfaceSunk },
      ]}
    >
      <View style={styles.happenedText}>
        <Text style={[styles.rowName, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.tileDetail, { color: colors.steel }]}>{hint}</Text>
      </View>
      <CaretRight size={18} color={colors.inkMuted} />
    </Pressable>
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
  greeting: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 38, marginTop: spacing.sm },
  body: { padding: spacing.lg, gap: spacing.xl },
  // The day on an oat panel under the shop at sunrise; the sale button is clay.
  today: { borderRadius: radius.panel, overflow: 'hidden', padding: spacing.xl, paddingBottom: 0 },
  todayArt: { width: '100%', maxWidth: 168, alignSelf: 'center' },
  todayText: { paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xs },
  todayHeadline: { fontFamily: fonts.display, fontSize: type.headline, lineHeight: 34 },
  todayDetail: { fontFamily: fonts.body, fontSize: type.body },
  todayActions: { marginTop: spacing.lg, gap: spacing.sm },
  target: { marginTop: spacing.md, gap: spacing.sm },
  search: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.small,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: type.input,
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
  tileTitle: { fontFamily: fonts.bodyBold, fontSize: type.title, marginTop: spacing.sm },
  tileDetail: { fontFamily: fonts.body, fontSize: type.label },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  // Stock state as a small printed square; the words beside it carry the meaning.
  signal: { width: 8, height: 8 },
  rowName: { flex: 1, fontFamily: fonts.body, fontSize: type.body },
  rowValue: { fontFamily: fonts.bodyBold, fontSize: type.body, fontVariant: ['tabular-nums'] },
  rowTime: { width: 52, textAlign: 'right', fontFamily: fonts.body, fontSize: type.label, fontVariant: ['tabular-nums'] },
  muted: { fontFamily: fonts.body, fontSize: type.body, paddingVertical: spacing.sm },
  requestRow: { paddingVertical: spacing.sm, gap: 2 },
  happenedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: spacing.sm },
  happenedText: { flex: 1, gap: 2 },
  // The severity reads like a printed stamp, as on the dashboard.
  stamp: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.small,
    fontFamily: fonts.bodyBold,
    fontSize: type.caption,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  requestStatus: { fontFamily: fonts.bodyBold, fontSize: type.label },
});
