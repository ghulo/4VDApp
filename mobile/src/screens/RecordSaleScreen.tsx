import { useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MagnifyingGlass } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { Minus } from 'phosphor-react-native/src/icons/Minus';
import { Plus } from 'phosphor-react-native/src/icons/Plus';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TabPicker } from '../components/TabPicker';
import { Button, EmptyState, ErrorState, Loading, TextField } from '../components/ui';
import { favoritesApi, productsApi, salesApi } from '../services/api';
import type { Customer, Product } from '../services/types';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage, formatMoney, promotionLabel } from '../utils/format';
import { salePriceFor } from '../utils/pricing';
import { useT } from '../i18n/useT';

/** Used both as the "Sell" tab and as a modal opened from a product. */
export function RecordSaleScreen() {
  const t = useT();
  const route = useRoute();
  const presetProductId = (route.params as { productId?: number } | undefined)?.productId;
  const [productId, setProductId] = useState<number | undefined>(presetProductId);

  const products = useQuery({
    queryKey: ['products', { page: 1, limit: 100, inStock: true, purpose: 'sell' }],
    queryFn: () => productsApi.list({ page: 1, limit: 100, inStock: true }),
  });

  if (products.isPending) return <Loading />;
  if (products.isError) return <ErrorState error={products.error} onRetry={() => products.refetch()} />;
  if (products.data.items.length === 0) return <EmptyState title={t.sell.nothingInStock} />;

  const selected = products.data.items.find((product) => product.id === productId);
  return selected ? (
    <SaleForm key={selected.id} product={selected} onChangeProduct={presetProductId ? undefined : () => setProductId(undefined)} />
  ) : (
    <ProductPicker products={products.data.items} onPick={setProductId} />
  );
}

/** Pick what was sold: type to narrow it down, favourites on top so the usual ones are one tap away. */
function ProductPicker({ products, onPick }: { products: Product[]; onPick: (id: number) => void }) {
  const colors = useThemeColors();
  const t = useT();
  const [search, setSearch] = useState('');
  const favoriteIds = useQuery({ queryKey: ['favorites', 'ids'], queryFn: favoritesApi.ids });

  const query = search.trim().toLowerCase();
  const matches = query
    ? products.filter((product) => product.name.toLowerCase().includes(query) || product.sku?.toLowerCase().includes(query))
    : products;
  const favorites = new Set(favoriteIds.data ?? []);
  const favoriteMatches = matches.filter((product) => favorites.has(product.id));
  const otherMatches = favoriteMatches.length > 0 ? matches.filter((product) => !favorites.has(product.id)) : matches;

  const row = (product: Product) => (
    <Pressable
      key={product.id}
      accessibilityRole="button"
      onPress={() => onPick(product.id)}
      style={({ pressed }) => [
        styles.pickerRow,
        { backgroundColor: pressed ? colors.surfaceSunk : colors.surface, borderColor: colors.line },
      ]}
    >
      <Text style={[styles.pickerName, { color: colors.ink }]}>{product.name}</Text>
      <Text style={[styles.pickerMeta, { color: colors.steel }]}>
        {t.sell.priceAndStock(formatMoney(product.promotion?.price ?? product.price), product.stock.quantity)}
      </Text>
    </Pressable>
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      stickyHeaderIndices={[0]}
    >
      <View style={[styles.searchBar, { backgroundColor: colors.background }]}>
        <View style={[styles.searchField, { borderColor: colors.lineStrong, backgroundColor: colors.surface }]}>
          <MagnifyingGlass size={20} color={colors.inkMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t.sell.searchPlaceholder}
            placeholderTextColor={colors.steel}
            accessibilityLabel={t.sell.searchLabel}
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, { color: colors.ink }]}
          />
        </View>
      </View>
      {matches.length === 0 && <Text style={[styles.hint, { color: colors.steel }]}>{t.sell.noMatch(search.trim())}</Text>}
      {favoriteMatches.length > 0 && (
        <>
          <Text style={[styles.groupTitle, { color: colors.ink }]} accessibilityRole="header">
            {t.sell.favorites}
          </Text>
          {favoriteMatches.map(row)}
          {otherMatches.length > 0 && (
            <Text style={[styles.groupTitle, { color: colors.ink }]} accessibilityRole="header">
              {t.sell.allProducts}
            </Text>
          )}
        </>
      )}
      {otherMatches.map(row)}
    </ScrollView>
  );
}

function SaleForm({ product, onChangeProduct }: { product: Product; onChangeProduct?: () => void }) {
  const colors = useThemeColors();
  const t = useT();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [tab, setTab] = useState<Customer | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: () => salesApi.record({ productId: product.id, quantity, notes: notes.trim() || null, ...(tab && { customerId: tab.id }) }),
    onSuccess: (sale) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['reports', 'my-sales'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setSavedMessage(
        t.sell.sold({ quantity: sale.quantity, product: sale.productName, amount: formatMoney(sale.totalAmount) }) + (tab ? t.tabs.soldOnTab(tab.name) : ''),
      );
      setQuantity(1);
      setNotes('');
      setTab(null);
    },
  });

  const { unitPrice, isPromotion } = salePriceFor(product, quantity);
  const maxQuantity = product.stock.quantity;
  const change = (delta: number) => {
    setSavedMessage(null);
    setQuantity((current) => Math.min(Math.max(current + delta, 1), maxQuantity));
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Text style={[styles.productName, { color: colors.ink }]}>{product.name}</Text>
          <Text style={[styles.pickerMeta, { color: colors.steel }]}>{t.sell.inStock(maxQuantity)}</Text>
          {onChangeProduct && (
            <Pressable accessibilityRole="button" onPress={onChangeProduct} hitSlop={8}>
              <Text style={[styles.link, { color: colors.ink }]}>{t.sell.chooseDifferent}</Text>
            </Pressable>
          )}
        </View>

        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Text style={[styles.label, { color: colors.ink }]}>{t.sell.howMany}</Text>
          <View style={styles.stepper}>
            <StepButton icon={Minus} accessibilityLabel={t.sell.oneLess} onPress={() => change(-1)} disabled={quantity <= 1} />
            <Text style={[styles.quantity, { color: colors.ink }]} accessibilityLiveRegion="polite">
              {quantity}
            </Text>
            <StepButton icon={Plus} accessibilityLabel={t.sell.oneMore} onPress={() => change(1)} disabled={quantity >= maxQuantity} />
          </View>
          <Text style={[styles.total, { color: colors.ink }]}>
            {quantity} × {formatMoney(unitPrice)} = {formatMoney(unitPrice * quantity)}
          </Text>
          {unitPrice < product.price && (
            <Text style={[styles.hint, { color: colors.stockOk }]}>
              {isPromotion && product.promotion ? `${product.promotion.name}: ${promotionLabel(product.promotion)}` : t.sell.bulkApplied}
            </Text>
          )}
        </View>

        <TextField label={t.sell.note} value={notes} onChangeText={setNotes} maxLength={1000} />
        <TabPicker value={tab} onChange={setTab} />

        {record.isError && (
          <Text style={[styles.message, { color: colors.signalOut }]} accessibilityRole="alert">
            {errorMessage(record.error)}
          </Text>
        )}
        {savedMessage && (
          <Text style={[styles.message, { color: colors.stockOk }]} accessibilityLiveRegion="polite">
            {savedMessage}
          </Text>
        )}
      </ScrollView>
      <View style={[styles.actionBar, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
        <Button
          label={`${t.sell.record} · ${formatMoney(unitPrice * quantity)}`}
          onPress={() => record.mutate()}
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
      <Icon size={26} color={colors.ink} weight="bold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  searchBar: { paddingBottom: spacing.sm },
  searchField: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, borderWidth: 1, borderRadius: radius.small, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, minHeight: 46, fontFamily: fonts.body, fontSize: 16 },
  groupTitle: { fontFamily: fonts.bodyBold, fontSize: 15, marginTop: spacing.sm },
  actionBar: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
  hint: { fontFamily: fonts.body, fontSize: 15 },
  pickerRow: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1 },
  pickerName: { fontFamily: fonts.bodyBold, fontSize: 16 },
  pickerMeta: { fontFamily: fonts.body, fontSize: 14 },
  panel: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1, gap: spacing.xs },
  productName: { fontFamily: fonts.serif, fontSize: 26 },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, textDecorationLine: 'underline', marginTop: spacing.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 14 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, marginVertical: spacing.sm },
  stepButton: { width: 56, height: 56, borderWidth: 1, borderRadius: radius.small, alignItems: 'center', justifyContent: 'center' },
  quantity: { fontFamily: fonts.displayBold, fontSize: 48, minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
  total: { fontFamily: fonts.bodyBold, fontSize: 18, fontVariant: ['tabular-nums'] },
  message: { fontFamily: fonts.bodyBold, fontSize: 15 },
});
