import { useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Barcode } from 'phosphor-react-native/src/icons/Barcode';
import { MagnifyingGlass } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { Minus } from 'phosphor-react-native/src/icons/Minus';
import { Plus } from 'phosphor-react-native/src/icons/Plus';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, Vibration, View } from 'react-native';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { TabPicker } from '../components/TabPicker';
import { Button, EmptyState, ErrorState, Loading, TextField } from '../components/ui';
import { favoritesApi, productsApi, salesApi } from '../services/api';
import type { Customer, Product } from '../services/types';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage, formatMoney } from '../utils/format';
import { salePriceFor } from '../utils/pricing';
import { useT } from '../i18n/useT';

const SEARCH_RESULTS = 8;
const QUICK_PICKS = 6;
const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

interface Line {
  product: Product;
  quantity: number;
}

/**
 * The counter's checkout, as the "Sell" tab and as a modal from a product:
 * scan, tap a favourite or search to fill the basket, then record it at once.
 */
export function RecordSaleScreen() {
  const t = useT();
  const route = useRoute();
  const presetProductId = (route.params as { productId?: number } | undefined)?.productId;
  const products = useQuery({
    queryKey: ['products', { page: 1, limit: 100, inStock: true, purpose: 'sell' }],
    queryFn: () => productsApi.list({ page: 1, limit: 100, inStock: true }),
  });

  if (products.isPending) return <Loading />;
  if (products.isError) return <ErrorState error={products.error} onRetry={() => products.refetch()} />;
  if (products.data.items.length === 0) return <EmptyState art="crate" title={t.sell.nothingInStock} />;

  const preset = products.data.items.find((product) => product.id === presetProductId);
  return <Basket key={presetProductId ?? 'tab'} products={products.data.items} initial={preset ? [{ product: preset, quantity: 1 }] : []} />;
}

function Basket({ products, initial }: { products: Product[]; initial: Line[] }) {
  const colors = useThemeColors();
  const t = useT();
  const queryClient = useQueryClient();
  const favoriteIds = useQuery({ queryKey: ['favorites', 'ids'], queryFn: favoritesApi.ids });
  const [lines, setLines] = useState<Line[]>(initial);
  const [search, setSearch] = useState('');
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [paid, setPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [tab, setTab] = useState<Customer | null>(null);

  const query = search.trim().toLowerCase();
  const matches = query
    ? products.filter((product) => product.name.toLowerCase().includes(query) || product.sku?.toLowerCase().includes(query) || product.barcode === search.trim()).slice(0, SEARCH_RESULTS)
    : [];
  const favorites = new Set(favoriteIds.data ?? []);
  const quickPicks = products.filter((product) => favorites.has(product.id)).slice(0, QUICK_PICKS);

  function add(product: Product) {
    setNotice(null);
    setLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (!existing) return [...current, { product, quantity: 1 }];
      return current.map((line) => (line === existing ? { ...line, quantity: Math.min(line.quantity + 1, product.stock.quantity) } : line));
    });
    setSearch('');
  }

  async function handleScan(code: string) {
    const known = products.find((product) => product.barcode === code);
    if (known) {
      Vibration.vibrate(30);
      return add(known);
    }
    try {
      const product = await productsApi.byBarcode(code);
      Vibration.vibrate(30);
      add(product);
    } catch {
      setNotice({ text: t.sell.notFound(code), ok: false });
    }
  }

  function change(productId: number, delta: number) {
    setLines((current) =>
      current
        .map((line) => (line.product.id === productId ? { ...line, quantity: Math.min(line.quantity + delta, line.product.stock.quantity) } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  const total = roundMoney(lines.reduce((sum, line) => sum + salePriceFor(line.product, line.quantity).unitPrice * line.quantity, 0));
  const paidAmount = Number(paid.replace(',', '.'));
  const giveBack = !tab && paid.trim() !== '' && paidAmount >= total ? roundMoney(paidAmount - total) : null;

  const record = useMutation({
    mutationFn: () =>
      salesApi.recordBasket({
        items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        notes: notes.trim() || null,
        ...(tab && { customerId: tab.id }),
      }),
    onSuccess: (result) => {
      for (const key of [['products'], ['reports', 'my-sales'], ['inventory'], ['customers'], ['cash']]) queryClient.invalidateQueries({ queryKey: key });
      Vibration.vibrate(60);
      setNotice({ text: t.sell.soldBasket(result.sales.length, formatMoney(result.total)) + (tab ? t.tabs.soldOnTab(tab.name) : ''), ok: true });
      setLines([]);
      setPaid('');
      setNotes('');
      setTab(null);
    },
  });

  const productRow = (product: Product) => (
    <Pressable
      key={product.id}
      accessibilityRole="button"
      accessibilityLabel={t.sell.addToBasket(product.name)}
      onPress={() => add(product)}
      style={({ pressed }) => [styles.pickerRow, { backgroundColor: pressed ? colors.surfaceSunk : colors.surface, borderColor: colors.line }]}
    >
      <Text style={[styles.pickerName, { color: colors.ink }]}>{product.name}</Text>
      <Text style={[styles.pickerMeta, { color: colors.steel }]}>
        {t.sell.priceAndStock(formatMoney(product.promotion?.price ?? product.price), product.stock.quantity)}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.searchRow}>
          <View style={[styles.searchField, { borderColor: colors.lineStrong, backgroundColor: colors.surface }]}>
            <MagnifyingGlass size={20} color={colors.inkMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={() => matches.length === 1 && add(matches[0]!)}
              placeholder={t.sell.searchPlaceholder}
              placeholderTextColor={colors.steel}
              accessibilityLabel={t.sell.searchLabel}
              autoCorrect={false}
              returnKeyType="search"
              style={[styles.searchInput, { color: colors.ink }]}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={scanning ? t.sell.stopScanning : t.sell.scan}
            accessibilityState={{ selected: scanning }}
            onPress={() => setScanning((current) => !current)}
            style={[styles.scanButton, { borderColor: colors.lineStrong, backgroundColor: scanning ? colors.selected : colors.surface }]}
          >
            <Barcode size={24} color={scanning ? colors.onSelected : colors.ink} />
          </Pressable>
        </View>

        {scanning && <BarcodeScanner onScan={handleScan} />}

        {query !== '' && matches.length === 0 && <Text style={[styles.hint, { color: colors.steel }]}>{t.sell.noMatch(search.trim())}</Text>}
        {matches.map(productRow)}

        {query === '' && quickPicks.length > 0 && (
          <>
            <Text style={[styles.groupTitle, { color: colors.ink }]} accessibilityRole="header">
              {t.sell.favorites}
            </Text>
            <View style={styles.tiles}>
              {quickPicks.map((product) => (
                <Pressable
                  key={product.id}
                  accessibilityRole="button"
                  accessibilityLabel={t.sell.addToBasket(product.name)}
                  onPress={() => add(product)}
                  style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? colors.surfaceSunk : colors.surface, borderColor: colors.line }]}
                >
                  <Text style={[styles.tileName, { color: colors.ink }]} numberOfLines={2}>
                    {product.name}
                  </Text>
                  <Text style={[styles.pickerMeta, { color: colors.steel }]}>{formatMoney(product.promotion?.price ?? product.price)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={[styles.groupTitle, { color: colors.ink }]} accessibilityRole="header">
          {t.sell.basket}
        </Text>
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {lines.length === 0 && <Text style={[styles.hint, { color: colors.steel }]}>{t.sell.emptyBasket}</Text>}
          {lines.map((line, index) => {
            const { unitPrice, isPromotion } = salePriceFor(line.product, line.quantity);
            return (
              <View key={line.product.id} style={[styles.line, index > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
                <View style={styles.lineText}>
                  <Text style={[styles.pickerName, { color: colors.ink }]}>{line.product.name}</Text>
                  <Text style={[styles.pickerMeta, { color: unitPrice < line.product.price ? colors.stockOk : colors.steel }]}>
                    {line.quantity} × {formatMoney(unitPrice)}
                    {unitPrice < line.product.price ? ` · ${isPromotion ? t.sell.promotionApplied : t.sell.bulkApplied}` : ''}
                  </Text>
                </View>
                <StepButton icon={Minus} accessibilityLabel={t.sell.oneLessOf(line.product.name)} onPress={() => change(line.product.id, -1)} disabled={false} />
                <Text style={[styles.quantity, { color: colors.ink }]} accessibilityLiveRegion="polite">
                  {line.quantity}
                </Text>
                <StepButton
                  icon={Plus}
                  accessibilityLabel={t.sell.oneMoreOf(line.product.name)}
                  onPress={() => change(line.product.id, 1)}
                  disabled={line.quantity >= line.product.stock.quantity}
                />
              </View>
            );
          })}
        </View>

        {lines.length > 0 && (
          <>
            {!tab && <TextField label={t.sell.paid} value={paid} onChangeText={setPaid} keyboardType="decimal-pad" placeholder="0,00" />}
            {giveBack !== null && <Text style={[styles.change, { color: colors.ink }]}>{t.sell.giveBack(formatMoney(giveBack))}</Text>}
            {!tab && paid.trim() !== '' && paidAmount < total && (
              <Text style={[styles.message, { color: colors.signalOut }]}>{t.sell.short(formatMoney(roundMoney(total - paidAmount)))}</Text>
            )}
            <TabPicker value={tab} onChange={setTab} />
            <TextField label={t.sell.note} value={notes} onChangeText={setNotes} maxLength={1000} />
          </>
        )}

        {record.isError && (
          <Text style={[styles.message, { color: colors.signalOut }]} accessibilityRole="alert">
            {errorMessage(record.error)}
          </Text>
        )}
        {notice && (
          <Text style={[styles.message, { color: notice.ok ? colors.stockOk : colors.signalOut }]} accessibilityLiveRegion="polite">
            {notice.text}
          </Text>
        )}
      </ScrollView>
      <View style={[styles.actionBar, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
        <Button
          label={`${t.sell.record} · ${formatMoney(total)}`}
          onPress={() => record.mutate()}
          disabled={lines.length === 0}
          loading={record.isPending}
        />
      </View>
    </View>
  );
}

function StepButton(props: { icon: typeof Plus; accessibilityLabel: string; onPress: () => void; disabled: boolean }) {
  const Icon = props.icon;
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[styles.stepButton, { borderColor: colors.lineStrong }, props.disabled && { opacity: 0.4 }]}
    >
      <Icon size={22} color={colors.ink} weight="bold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  searchRow: { flexDirection: 'row', gap: spacing.sm },
  searchField: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, borderWidth: 1, borderRadius: radius.small, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, minHeight: 46, fontFamily: fonts.body, fontSize: 16 },
  scanButton: { width: 48, height: 48, borderWidth: 1, borderRadius: radius.small, alignItems: 'center', justifyContent: 'center' },
  groupTitle: { fontFamily: fonts.bodyBold, fontSize: 15, marginTop: spacing.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { flexBasis: '48%', flexGrow: 1, minHeight: 72, padding: spacing.md, borderWidth: 1, borderRadius: radius.panel, justifyContent: 'space-between' },
  tileName: { fontFamily: fonts.bodyBold, fontSize: 16 },
  actionBar: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
  hint: { fontFamily: fonts.body, fontSize: 15 },
  pickerRow: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1 },
  pickerName: { fontFamily: fonts.bodyBold, fontSize: 16 },
  pickerMeta: { fontFamily: fonts.body, fontSize: 14 },
  panel: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.panel, borderWidth: 1 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  lineText: { flex: 1, gap: 2 },
  stepButton: { width: 44, height: 44, borderWidth: 1, borderRadius: radius.small, alignItems: 'center', justifyContent: 'center' },
  quantity: { fontFamily: fonts.bodyBold, fontSize: 20, minWidth: 32, textAlign: 'center', fontVariant: ['tabular-nums'] },
  change: { fontFamily: fonts.bodyBold, fontSize: 20, fontVariant: ['tabular-nums'] },
  message: { fontFamily: fonts.bodyBold, fontSize: 15 },
});
