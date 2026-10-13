import { Package } from 'phosphor-react-native/src/icons/Package';
import { useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Barcode } from 'phosphor-react-native/src/icons/Barcode';
import { Check } from 'phosphor-react-native/src/icons/Check';
import { MagnifyingGlass } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { Minus } from 'phosphor-react-native/src/icons/Minus';
import { Plus } from 'phosphor-react-native/src/icons/Plus';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, Vibration, View } from 'react-native';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { ProductPhoto } from '../components/ProductPhoto';
import { TabPicker } from '../components/TabPicker';
import { Button, EmptyState, ErrorState, Loading, TextField } from '../components/ui';
import { documentsApi, favoritesApi, productsApi, salesApi, settingsApi } from '../services/api';
import { decidesRequests, useCurrentUser } from '../state/useAuth';
import type { Customer, DocumentRef, Product } from '../services/types';
import { fonts, keyShadow, keyTravel, radius, spacing, useThemeColors, type } from '../theme';
import { errorMessage, formatMoney } from '../utils/format';
import { salePriceFor } from '../utils/pricing';
import { canPrint, printDocument } from '../utils/printDocument';
import { useT } from '../i18n/useT';
import { useTabBarSpace } from '../components/TabBarSpace';

const SEARCH_RESULTS = 9;
/** Three rows of shelf tiles before "Show all". */
const SHELF_SHOWN = 9;
const TILE_GAP = spacing.sm;
const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

/** The unit price after a rabat, rounded like the server rounds it. */
const afterDiscount = (price: number, percent: number) => (percent > 0 ? roundMoney(price * (1 - percent / 100)) : price);

interface Line {
  product: Product;
  quantity: number;
}

/**
 * The counter's checkout, as the "Sell" tab and as a modal from a product:
 * scan, tap a tile or search to fill the basket, then record it at once.
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
  if (products.data.items.length === 0) return <EmptyState icon={Package} title={t.sell.nothingInStock} />;

  const preset = products.data.items.find((product) => product.id === presetProductId);
  return <Basket key={presetProductId ?? 'tab'} products={products.data.items} initial={preset ? [{ product: preset, quantity: 1 }] : []} />;
}

function Basket({ products, initial }: { products: Product[]; initial: Line[] }) {
  const tabBarSpace = useTabBarSpace();
  const colors = useThemeColors();
  const t = useT();
  const queryClient = useQueryClient();
  const favoriteIds = useQuery({ queryKey: ['favorites', 'ids'], queryFn: favoritesApi.ids });
  const [lines, setLines] = useState<Line[]>(initial);
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [paid, setPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [onTab, setOnTab] = useState(false);
  // Only a sale on a tab leaves the money out of the drawer.
  const tab = onTab ? customer : null;
  const [sold, setSold] = useState<{ total: number; products: number; tabName: string | null; invoice: DocumentRef } | null>(null);
  const [discount, setDiscount] = useState('');
  // Rabat, customer and note stay folded away until someone asks for them.
  const [extras, setExtras] = useState({ discount: false, customer: false, note: false });
  const [showWholeShelf, setShowWholeShelf] = useState(false);
  // What "Clear" took out, so one tap can put it back.
  const [cleared, setCleared] = useState<Line[] | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const user = useCurrentUser();
  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  // Owners and admins give any rabat; everyone else up to the shop's limit.
  const discountLimit = decidesRequests(user) ? 100 : (settings.data?.employeeDiscountLimit ?? 0);
  const discountText = discount.trim().replace(',', '.');
  const discountPercent = discountText === '' || !Number.isFinite(Number(discountText)) ? 0 : roundMoney(Number(discountText));
  const discountTooHigh = discountPercent > discountLimit || discountPercent < 0;

  const query = search.trim().toLowerCase();
  const matches = query
    ? products.filter((product) => product.name.toLowerCase().includes(query) || product.sku?.toLowerCase().includes(query) || product.barcode === search.trim()).slice(0, SEARCH_RESULTS)
    : [];
  const favorites = new Set(favoriteIds.data ?? []);
  const favoritePicks = products.filter((product) => favorites.has(product.id));
  const shelf = products.filter((product) => !favorites.has(product.id));
  const shelfShown = showWholeShelf ? shelf : shelf.slice(0, SHELF_SHOWN);
  const inBasket = new Map(lines.map((line) => [line.product.id, line.quantity]));
  // Three tiles to a row; measured, because the web build caps the column at 520.
  const tileWidth = gridWidth > 0 ? Math.floor((gridWidth - TILE_GAP * 2) / 3) : undefined;

  function add(product: Product) {
    setNotFound(null);
    setSold(null);
    setCleared(null);
    print.reset();
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
      setNotFound(t.sell.notFound(code));
    }
  }

  function change(productId: number, delta: number) {
    setLines((current) =>
      current
        .map((line) => (line.product.id === productId ? { ...line, quantity: Math.min(line.quantity + delta, line.product.stock.quantity) } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  function clear() {
    setLines([]);
    setPaid('');
    setNotes('');
    setDiscount('');
    setCustomer(null);
    setOnTab(false);
    setExtras({ discount: false, customer: false, note: false });
  }

  const listTotal = roundMoney(lines.reduce((sum, line) => sum + salePriceFor(line.product, line.quantity).unitPrice * line.quantity, 0));
  const total = roundMoney(
    lines.reduce((sum, line) => sum + afterDiscount(salePriceFor(line.product, line.quantity).unitPrice, discountPercent) * line.quantity, 0),
  );
  const paidAmount = Number(paid.replace(',', '.'));
  const giveBack = !tab && paid.trim() !== '' && paidAmount >= total ? roundMoney(paidAmount - total) : null;

  const record = useMutation({
    mutationFn: () =>
      salesApi.recordBasket({
        items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity, ...(discountPercent > 0 && { discountPercent }) })),
        notes: notes.trim() || null,
        ...(customer && { customerId: customer.id, paidNow: !onTab }),
      }),
    onSuccess: (result) => {
      for (const key of [['products'], ['reports', 'my-sales'], ['inventory'], ['customers'], ['cash']]) queryClient.invalidateQueries({ queryKey: key });
      Vibration.vibrate(60);
      setSold({ total: result.total, products: result.sales.length, tabName: tab?.name ?? null, invoice: result.invoice });
      clear();
    },
  });

  const print = useMutation({
    mutationFn: (document: DocumentRef) => printDocument(() => documentsApi.printPage(document.id), document.number),
  });

  const tiles = (list: Product[]) => (
    <View style={styles.tiles} onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}>
      {list.map((product) => (
        <ProductTile key={product.id} product={product} quantity={inBasket.get(product.id) ?? 0} width={tileWidth} onPress={() => add(product)} />
      ))}
    </View>
  );

  const extraChip = (key: keyof typeof extras, label: string) => (
    <Button key={key} variant="quiet" size="small" icon={Plus} label={label} onPress={() => setExtras((current) => ({ ...current, [key]: true }))} />
  );

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.searchRow}>
          <View style={[styles.searchField, { borderColor: searchFocused ? colors.ink : colors.lineStrong, backgroundColor: colors.surface, boxShadow: colors.inset }]}>
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
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={[styles.searchInput, { color: colors.ink }]}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={scanning ? t.sell.stopScanning : t.sell.scan}
            accessibilityState={{ selected: scanning }}
            onPress={() => setScanning((current) => !current)}
            style={({ pressed }) => [
              styles.scanButton,
              { borderColor: scanning ? colors.selected : colors.lineStrong, backgroundColor: scanning ? colors.selected : pressed ? colors.surfaceSunk : colors.surface },
              !scanning && { boxShadow: keyShadow(colors, 'paper', pressed), ...keyTravel(pressed) },
            ]}
          >
            <Barcode size={24} color={scanning ? colors.onSelected : colors.ink} />
          </Pressable>
        </View>

        {scanning && <BarcodeScanner onScan={handleScan} />}
        {notFound && (
          <Text style={[styles.message, { color: colors.signalOut }]} accessibilityLiveRegion="polite">
            {notFound}
          </Text>
        )}

        {cleared && lines.length === 0 && (
          <View style={styles.receiptHead} accessibilityLiveRegion="polite">
            <Text style={[styles.hint, { color: colors.inkMuted }]}>{t.sell.basketCleared}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setLines(cleared);
                setCleared(null);
              }}
              hitSlop={12}
              style={styles.clear}
            >
              <Text style={[styles.link, { color: colors.ink }]}>{t.sell.undo}</Text>
            </Pressable>
          </View>
        )}

        {sold && (
          <View style={[styles.receipt, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]} accessibilityLiveRegion="polite">
            <View style={styles.soldHead}>
              <View style={[styles.soldMark, { backgroundColor: colors.okSoft }]}>
                <Check size={18} color={colors.ok} weight="bold" />
              </View>
              <Text style={[styles.soldTitle, { color: colors.ink }]}>{t.sell.soldTitle}</Text>
              <Text style={[styles.totalFigure, { color: colors.ink }]}>{formatMoney(sold.total)}</Text>
            </View>
            <Text style={[styles.meta, { color: colors.inkMuted }]}>
              {t.sell.soldBasket(sold.products, formatMoney(sold.total)) + (sold.tabName ? t.tabs.soldOnTab(sold.tabName) : '') + t.sell.invoiceReady(sold.invoice.number)}
            </Text>
            {canPrint && <Button label={t.sell.printInvoice} variant="quiet" onPress={() => print.mutate(sold.invoice)} loading={print.isPending} />}
            {print.isError && (
              <Text style={[styles.message, { color: colors.signalOut }]} accessibilityLiveRegion="polite">
                {print.error.message === 'blocked' ? t.sell.printBlocked : errorMessage(print.error)}
              </Text>
            )}
          </View>
        )}

        {lines.length > 0 && (
          <View style={[styles.receipt, { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise }]}>
            <View style={styles.receiptHead}>
              <Text style={[styles.groupTitle, { color: colors.ink }]} accessibilityRole="header">
                {t.sell.basket}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => { setCleared(lines); clear(); }} hitSlop={12} style={styles.clear}>
                <Text style={[styles.link, { color: colors.inkMuted }]}>{t.sell.clear}</Text>
              </Pressable>
            </View>
            {lines.map((line) => {
              const { unitPrice, isPromotion } = salePriceFor(line.product, line.quantity);
              const cheaper = unitPrice < line.product.price;
              return (
                <View key={line.product.id} style={[styles.line, { borderTopColor: colors.line }]}>
                  <View style={styles.lineRow}>
                    <Text style={[styles.lineName, { color: colors.ink }]} numberOfLines={2}>
                      {line.product.name}
                    </Text>
                    <Text style={[styles.lineTotal, { color: colors.ink }]}>{formatMoney(roundMoney(unitPrice * line.quantity))}</Text>
                  </View>
                  <View style={styles.lineRow}>
                    <Text style={[styles.meta, { color: cheaper ? colors.ok : colors.inkMuted }]}>
                      {t.sell.each(formatMoney(unitPrice))}
                      {cheaper ? ` · ${isPromotion ? t.sell.promotionApplied : t.sell.bulkApplied}` : ''}
                    </Text>
                    <View style={[styles.stepper, { backgroundColor: colors.surfaceSunk, boxShadow: colors.inset }]}>
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
                  </View>
                </View>
              );
            })}

            {/* The tear line of a till receipt, then what is owed. */}
            <View style={[styles.tear, { borderColor: colors.lineStrong }]} />
            {discountPercent > 0 && !discountTooHigh && (
              <View style={styles.lineRow}>
                <Text style={[styles.meta, { color: colors.inkMuted }]}>{t.sell.discountOff(discountText)}</Text>
                <Text style={[styles.meta, { color: colors.inkMuted }]}>−{formatMoney(roundMoney(listTotal - total))}</Text>
              </View>
            )}
            <View style={styles.lineRow}>
              <Text style={[styles.groupTitle, { color: colors.ink }]}>{t.sell.total}</Text>
              <Text style={[styles.totalFigure, { color: colors.ink }]} accessibilityLiveRegion="polite">
                {formatMoney(total)}
              </Text>
            </View>

            {!tab && (
              <View style={styles.cash}>
                <TextField label={t.sell.paid} value={paid} onChangeText={setPaid} keyboardType="decimal-pad" placeholder="0,00" />
                {giveBack !== null && <Text style={[styles.change, { color: colors.ink }]}>{t.sell.giveBack(formatMoney(giveBack))}</Text>}
                {paid.trim() !== '' && paidAmount < total && (
                  <Text style={[styles.change, { color: colors.signalOut }]}>{t.sell.short(formatMoney(roundMoney(total - paidAmount)))}</Text>
                )}
              </View>
            )}

            {extras.discount && (
              <TextField
                label={t.sell.discount}
                value={discount}
                onChangeText={setDiscount}
                keyboardType="decimal-pad"
                placeholder="0"
                autoFocus
                hint={discountLimit < 100 ? t.sell.discountUpTo(discountLimit) : undefined}
                error={discountTooHigh ? t.sell.discountTooHigh(discountLimit) : undefined}
              />
            )}
            {(extras.customer || customer) && (
              <TabPicker
                value={customer}
                onChange={setCustomer}
                onTab={onTab}
                onTabChange={setOnTab}
                initiallyOpen
                onDismiss={() => setExtras((current) => ({ ...current, customer: false }))}
              />
            )}
            {extras.note && <TextField label={t.sell.note} value={notes} onChangeText={setNotes} maxLength={1000} autoFocus />}
            {!(extras.discount && (extras.customer || customer) && extras.note) && (
              <View style={styles.extras}>
                {!extras.discount && extraChip('discount', t.sell.addDiscount)}
                {!extras.customer && !customer && extraChip('customer', t.sell.addCustomer)}
                {!extras.note && extraChip('note', t.sell.addNote)}
              </View>
            )}

            {record.isError && (
              <Text style={[styles.message, { color: colors.signalOut }]} accessibilityRole="alert">
                {errorMessage(record.error)}
              </Text>
            )}
          </View>
        )}

        {query !== '' ? (
          matches.length === 0 ? (
            <Text style={[styles.hint, { color: colors.steel }]}>{t.sell.noMatch(search.trim())}</Text>
          ) : (
            tiles(matches)
          )
        ) : (
          <>
            {favoritePicks.length > 0 && (
              <>
                <Text style={[styles.groupTitle, { color: colors.ink }]} accessibilityRole="header">
                  {t.sell.favorites}
                </Text>
                {tiles(favoritePicks)}
              </>
            )}
            {shelf.length > 0 && (
              <>
                <Text style={[styles.groupTitle, { color: colors.ink }]} accessibilityRole="header">
                  {t.sell.onShelf}
                </Text>
                {favoritePicks.length === 0 && <Text style={[styles.hint, { color: colors.steel }]}>{t.sell.pinFavorites}</Text>}
                {tiles(shelfShown)}
                {shelf.length > SHELF_SHOWN && !showWholeShelf && (
                  <Button label={t.sell.showAll(shelf.length)} variant="quiet" onPress={() => setShowWholeShelf(true)} />
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
      <View style={[styles.actionBar, { backgroundColor: colors.surface, borderTopColor: colors.line, marginBottom: tabBarSpace }]}>
        {lines.length > 0 ? (
          <Button label={`${t.sell.record} · ${formatMoney(total)}`} onPress={() => record.mutate()} disabled={discountTooHigh} loading={record.isPending} />
        ) : (
          // Nothing to record yet: say how to start instead of showing a dead button.
          <Text style={[styles.startHint, { color: colors.inkMuted }]}>{t.sell.emptyBasket}</Text>
        )}
      </View>
    </View>
  );
}

/** One product to tap into the basket: photo, name, price; how many are already in it. */
function ProductTile({ product, quantity, width, onPress }: { product: Product; quantity: number; width: number | undefined; onPress: () => void }) {
  const colors = useThemeColors();
  const t = useT();
  const full = quantity >= product.stock.quantity;
  const low = product.stock.quantity <= product.stock.reorderLevel;
  // Without a photo the empty photo box would be the biggest thing on the tile:
  // a small box instead, and the name and price get the room.
  const hasPhoto = product.imageUrl !== null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={quantity > 0 ? t.sell.inBasket(product.name, quantity) : t.sell.addToBasket(product.name)}
      accessibilityState={{ disabled: full }}
      disabled={full}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        width === undefined ? styles.tileFallback : { width },
        { backgroundColor: colors.surface, borderColor: quantity > 0 ? colors.ink : colors.line, boxShadow: pressed ? colors.inset : colors.raise },
        full && { backgroundColor: colors.surfaceSunk, boxShadow: 'none' },
      ]}
    >
      <View>
        <ProductPhoto uri={product.imageUrl} size={hasPhoto ? 'fill' : 32} />
        {quantity > 0 && (
          <View style={[styles.count, { backgroundColor: colors.ink }]}>
            <Text style={[styles.countText, { color: colors.surface }]}>{quantity}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.tileName, { color: colors.ink }]} numberOfLines={hasPhoto ? 2 : 3}>
        {product.name}
      </Text>
      <Text style={[styles.tilePrice, !hasPhoto && styles.tilePriceBare, { color: colors.ink }]}>{formatMoney(product.promotion?.price ?? product.price)}</Text>
      {low && <Text style={[styles.tileLeft, { color: colors.warn }]}>{t.sell.left(product.stock.quantity)}</Text>}
    </Pressable>
  );
}

/** − or + inside the basket's quantity track: a small paper key. */
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
      style={({ pressed }) => [
        styles.stepButton,
        !props.disabled && { backgroundColor: pressed ? colors.fill : colors.surface, boxShadow: keyShadow(colors, 'paper', pressed), ...keyTravel(pressed) },
      ]}
    >
      <Icon size={18} color={props.disabled ? colors.inkMuted : colors.ink} weight="bold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  searchRow: { flexDirection: 'row', gap: spacing.sm },
  searchField: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, borderWidth: 1, borderRadius: radius.small, paddingHorizontal: spacing.md },
  // The whole field shows focus (see searchFocused), so the browser's ring on the bare input is off.
  searchInput: { flex: 1, minHeight: 46, fontFamily: fonts.body, fontSize: type.input, outlineStyle: 'solid', outlineWidth: 0 },
  scanButton: { width: 48, height: 48, borderWidth: 1, borderRadius: radius.small, alignItems: 'center', justifyContent: 'center' },
  groupTitle: { fontFamily: fonts.bodyBold, fontSize: type.body },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP },
  tile: { padding: spacing.sm, gap: spacing.xs, borderWidth: 1, borderRadius: radius.panel },
  tileFallback: { width: '31%' },
  count: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    minWidth: 24,
    height: 24,
    paddingHorizontal: spacing.xs,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontFamily: fonts.bodyBold, fontSize: type.label, fontVariant: ['tabular-nums'] },
  tileName: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 17, minHeight: 34 },
  tilePrice: { fontFamily: fonts.bodyBold, fontSize: type.body, fontVariant: ['tabular-nums'] },
  tilePriceBare: { marginTop: 'auto' },
  tileLeft: { fontFamily: fonts.bodyBold, fontSize: type.caption },
  receipt: { padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderRadius: radius.panel },
  receiptHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clear: { minHeight: 32, justifyContent: 'center' },
  link: { fontFamily: fonts.bodyMedium, fontSize: type.label, textDecorationLine: 'underline' },
  line: { gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1 },
  lineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  lineName: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.body },
  lineTotal: { fontFamily: fonts.bodyBold, fontSize: type.body, fontVariant: ['tabular-nums'] },
  meta: { flexShrink: 1, fontFamily: fonts.body, fontSize: type.label, fontVariant: ['tabular-nums'] },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: 2, borderRadius: radius.small },
  stepButton: { width: 44, height: 40, borderRadius: radius.small - 2, alignItems: 'center', justifyContent: 'center' },
  quantity: { fontFamily: fonts.bodyBold, fontSize: type.title, minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] },
  tear: { borderTopWidth: 1, borderStyle: 'dashed', marginVertical: spacing.xs },
  totalFigure: { fontFamily: fonts.bodyBold, fontSize: type.figure, fontVariant: ['tabular-nums'] },
  cash: { marginTop: spacing.sm },
  change: { fontFamily: fonts.bodyBold, fontSize: type.title, fontVariant: ['tabular-nums'], marginTop: -spacing.sm, marginBottom: spacing.md },
  extras: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  soldHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  soldMark: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  soldTitle: { flex: 1, fontFamily: fonts.display, fontSize: type.title },
  actionBar: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
  startHint: { fontFamily: fonts.body, fontSize: type.body, textAlign: 'center' },
  hint: { fontFamily: fonts.body, fontSize: type.body },
  message: { fontFamily: fonts.bodyBold, fontSize: type.body },
});
