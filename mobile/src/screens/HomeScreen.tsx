import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { monthRanges, MY_SALES_QUERY_KEY } from '../components/MySales';
import type { RootStackParamList } from '../navigation/types';
import { approvalsApi, countsApi, favoritesApi, inventoryApi, productsApi, reportsApi } from '../services/api';
import type { MyRequest } from '../services/types';
import { canRecordSales, useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, type ThemeColors, useThemeColors } from '../theme';
import { formatMoney } from '../utils/format';

const LOW_STOCK_SHOWN = 5;
const RECENT_SALES_SHOWN = 3;
/** Decided requests stay on Home this long, so a rejection reason isn't missed. */
const DECIDED_SHOWN_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const REQUEST_STATUS: Record<string, string> = {
  pending: 'Waiting for the owner',
  submitted: 'Waiting for the owner',
  approved: 'Approved',
  closed: 'Reviewed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const timeOfDay = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
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

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function HomeScreen() {
  const colors = useThemeColors();
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
  const productCount = useQuery({
    queryKey: ['products', { page: 1, limit: 1, purpose: 'count' }],
    queryFn: () => productsApi.list({ page: 1, limit: 1 }),
    select: (page) => page.meta.total,
  });
  const favoriteCount = useQuery({ queryKey: ['favorites', 'ids'], queryFn: favoritesApi.ids, select: (ids) => ids.length });
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
      <View style={[styles.hero, { backgroundColor: colors.heroInk, paddingTop: insets.top + spacing.xl }]}>
        <Text style={[styles.greeting, { color: colors.heroText }]}>
          {greeting(now)}, {firstName}
        </Text>
        <Text style={[styles.date, { color: colors.heroMuted }]}>{longDate.format(now)}</Text>

        {sells && (
          <View style={styles.todayBlock} accessible accessibilityLabel={todayLabel(today.data?.current)}>
            <Text style={[styles.todayCaption, { color: colors.heroMuted }]}>Your sales today</Text>
            <Text style={[styles.todayFigure, { color: colors.heroText }]}>
              {today.data ? formatMoney(today.data.current.revenue) : today.isError ? 'Not available' : '…'}
            </Text>
            {today.data && (
              <Text style={[styles.todayDetail, { color: colors.heroMuted }]}>
                {plural(today.data.current.salesCount, 'sale', 'sales')}
                {thisMonth.data ? `, ${formatMoney(thisMonth.data.current.revenue)} so far in ${month.name}` : ''}
              </Text>
            )}
          </View>
        )}

        {sells && (
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('RecordSale', {})}
            style={({ pressed }) => [styles.sellButton, { backgroundColor: colors.heroText }, pressed && styles.pressed]}
          >
            <Text style={[styles.sellPlus, { color: colors.heroInk }]}>+</Text>
            <Text style={[styles.sellLabel, { color: colors.heroInk }]}>Record a sale</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.body}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={openSearch}
          placeholder="Search products by name or SKU"
          placeholderTextColor={colors.steel}
          accessibilityLabel="Search products"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.search, { color: colors.ink, borderColor: colors.lineStrong, backgroundColor: colors.surface }]}
        />

        <View style={styles.tools}>
          <ToolTile
            colors={colors}
            title="Products"
            detail={productCount.data === undefined ? 'Browse the catalogue' : plural(productCount.data, 'product', 'products')}
            onPress={() => navigation.navigate('Main', { screen: 'Catalog' })}
          />
          <ToolTile
            colors={colors}
            title="Favorites"
            detail={favoriteCount.data ? `${favoriteCount.data} saved` : 'Nothing saved yet'}
            onPress={() => navigation.navigate('Main', { screen: 'Favorites' })}
          />
          {sells && (
            <ToolTile
              colors={colors}
              title="My sales"
              detail={thisMonth.data ? plural(thisMonth.data.current.salesCount, 'sale', 'sales') + ` in ${month.name}` : month.name}
              onPress={() => navigation.navigate('MySales')}
            />
          )}
          {sells && (
            <ToolTile
              colors={colors}
              title="Stock count"
              detail={openCounts > 0 ? `${openCounts} ${openCounts === 1 ? 'count' : 'counts'} open` : 'Start a count'}
              onPress={() => navigation.navigate('Counts')}
            />
          )}
          <ToolTile
            colors={colors}
            title="Account"
            detail={user.email}
            onPress={() => navigation.navigate('Main', { screen: 'Account' })}
          />
        </View>

        {sells && visibleRequests.length > 0 && (
          <Section title="Your requests" colors={colors}>
            {visibleRequests.map((request) => (
              <RequestRow key={`${request.type}-${request.id}`} request={request} colors={colors} />
            ))}
          </Section>
        )}

        <Section title="Running low" colors={colors}>
          {lowStock.isPending && <Muted colors={colors}>Checking stock…</Muted>}
          {lowStock.isError && <Muted colors={colors}>Stock levels could not be loaded. Pull down to try again.</Muted>}
          {lowStock.data?.items.length === 0 && <Muted colors={colors}>Everything is well stocked.</Muted>}
          {lowStock.data?.items.map((item) => {
            const isOut = item.quantity === 0;
            return (
              <Pressable
                key={item.productId}
                accessibilityRole="button"
                accessibilityLabel={`${item.productName}, ${isOut ? 'sold out' : `${item.quantity} left`}`}
                onPress={() => navigation.navigate('ProductDetail', { productId: item.productId, name: item.productName })}
                style={({ pressed }) => [styles.row, { borderTopColor: colors.line }, pressed && styles.pressed]}
              >
                <View style={[styles.signal, { backgroundColor: isOut ? colors.signalOut : colors.signalLow }]} />
                <Text style={[styles.rowName, { color: colors.ink }]} numberOfLines={1}>
                  {item.productName}
                </Text>
                <Text style={[styles.rowValue, { color: isOut ? colors.signalOut : colors.ink }]}>
                  {isOut ? 'Sold out' : `${item.quantity} left`}
                </Text>
              </Pressable>
            );
          })}
          {lowStock.data && lowStock.data.meta.total > lowStock.data.items.length && (
            <Muted colors={colors}>
              And {plural(lowStock.data.meta.total - lowStock.data.items.length, 'more product', 'more products')}.
            </Muted>
          )}
        </Section>

        {sells && (
          <Section title="Your latest sales" colors={colors}>
            {thisMonth.data && recentSales.length === 0 && (
              <Muted colors={colors}>No sales yet this month. Record one with the button at the top.</Muted>
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

function RequestRow({ request, colors }: { request: MyRequest; colors: ThemeColors }) {
  const isRejected = request.status === 'rejected';
  const isWaiting = request.status === 'pending' || request.status === 'submitted';
  return (
    <View style={[styles.requestRow, { borderTopColor: colors.line }]}>
      <Text style={[styles.rowName, { color: colors.ink }]}>{request.summary}</Text>
      <Text style={[styles.requestStatus, { color: isRejected ? colors.signalOut : isWaiting ? colors.signalLowInk : colors.stockOk }]}>
        {REQUEST_STATUS[request.status] ?? request.status}
        {isRejected && request.decisionNote ? `: ${request.decisionNote}` : ''}
      </Text>
    </View>
  );
}

function todayLabel(totals?: { revenue: number; salesCount: number }): string {
  if (!totals) return 'Your sales today are loading';
  return `Your sales today: ${formatMoney(totals.revenue)} from ${plural(totals.salesCount, 'sale', 'sales')}`;
}

/** "10:42" for today, "28 Sep" for earlier days. */
function saleTime(iso: string, now: Date): string {
  const date = new Date(iso);
  return date.toDateString() === now.toDateString()
    ? timeOfDay.format(date)
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date);
}

interface ToolTileProps {
  colors: ThemeColors;
  title: string;
  detail: string;
  onPress: () => void;
}

function ToolTile({ colors, title, detail, onPress }: ToolTileProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: colors.surface, borderColor: colors.line },
        pressed && { backgroundColor: colors.background },
      ]}
    >
      <Text style={[styles.tileTitle, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.tileDetail, { color: colors.steel }]} numberOfLines={1}>
        {detail}
      </Text>
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
  hero: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xs },
  greeting: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 34 },
  date: { fontFamily: fonts.body, fontSize: 16 },
  todayBlock: { marginTop: spacing.xl },
  todayCaption: { fontFamily: fonts.bodyBold, fontSize: 14 },
  todayFigure: { fontFamily: fonts.displayBold, fontSize: 64, lineHeight: 68, fontVariant: ['tabular-nums'] },
  todayDetail: { fontFamily: fonts.body, fontSize: 15 },
  sellButton: {
    marginTop: spacing.xl,
    minHeight: 56,
    borderRadius: radius.small,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  sellPlus: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 30 },
  sellLabel: { fontFamily: fonts.displayBold, fontSize: 22 },
  pressed: { opacity: 0.8 },
  body: { padding: spacing.lg, gap: spacing.lg },
  search: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.small,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 88,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.panel,
    justifyContent: 'space-between',
  },
  tileTitle: { fontFamily: fonts.displayBold, fontSize: 22 },
  tileDetail: { fontFamily: fonts.body, fontSize: 14 },
  section: { borderWidth: 1, borderRadius: radius.panel, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 20, marginBottom: spacing.sm },
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
