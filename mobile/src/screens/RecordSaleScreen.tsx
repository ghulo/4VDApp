import { useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, EmptyState, ErrorState, Loading, TextField } from '../components/ui';
import { productsApi, salesApi } from '../services/api';
import type { Product } from '../services/types';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage, formatMoney } from '../utils/format';
import { unitPriceFor } from '../utils/pricing';

/** Used both as the "Sell" tab and as a modal opened from a product. */
export function RecordSaleScreen() {
  const route = useRoute();
  const presetProductId = (route.params as { productId?: number } | undefined)?.productId;
  const [productId, setProductId] = useState<number | undefined>(presetProductId);

  const products = useQuery({
    queryKey: ['products', { page: 1, limit: 100, inStock: true, purpose: 'sell' }],
    queryFn: () => productsApi.list({ page: 1, limit: 100, inStock: true }),
  });

  if (products.isPending) return <Loading />;
  if (products.isError) return <ErrorState error={products.error} onRetry={() => products.refetch()} />;
  if (products.data.items.length === 0) return <EmptyState title="Nothing in stock to sell" />;

  const selected = products.data.items.find((product) => product.id === productId);
  return selected ? (
    <SaleForm key={selected.id} product={selected} onChangeProduct={presetProductId ? undefined : () => setProductId(undefined)} />
  ) : (
    <ProductPicker products={products.data.items} onPick={setProductId} />
  );
}

function ProductPicker({ products, onPick }: { products: Product[]; onPick: (id: number) => void }) {
  const colors = useThemeColors();
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.hint, { color: colors.steel }]}>Which product did you sell?</Text>
      {products.map((product) => (
        <Pressable
          key={product.id}
          accessibilityRole="button"
          onPress={() => onPick(product.id)}
          style={({ pressed }) => [
            styles.pickerRow,
            { backgroundColor: pressed ? colors.background : colors.surface, borderColor: colors.line },
          ]}
        >
          <Text style={[styles.pickerName, { color: colors.ink }]}>{product.name}</Text>
          <Text style={[styles.pickerMeta, { color: colors.steel }]}>
            {formatMoney(product.price)}, {product.stock.quantity} in stock
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function SaleForm({ product, onChangeProduct }: { product: Product; onChangeProduct?: () => void }) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: () => salesApi.record({ productId: product.id, quantity, notes: notes.trim() || null }),
    onSuccess: (sale) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setSavedMessage(`Sold ${sale.quantity} × ${sale.productName} for ${formatMoney(sale.totalAmount)}.`);
      setQuantity(1);
      setNotes('');
    },
  });

  const unitPrice = unitPriceFor(product.price, product.bulkPricingTiers, quantity);
  const maxQuantity = product.stock.quantity;
  const change = (delta: number) => {
    setSavedMessage(null);
    setQuantity((current) => Math.min(Math.max(current + delta, 1), maxQuantity));
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.productName, { color: colors.ink }]}>{product.name}</Text>
        <Text style={[styles.pickerMeta, { color: colors.steel }]}>{maxQuantity} in stock</Text>
        {onChangeProduct && (
          <Pressable accessibilityRole="button" onPress={onChangeProduct} hitSlop={8}>
            <Text style={[styles.link, { color: colors.ink }]}>Choose a different product</Text>
          </Pressable>
        )}
      </View>

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.label, { color: colors.ink }]}>How many</Text>
        <View style={styles.stepper}>
          <StepButton label="−" accessibilityLabel="One less" onPress={() => change(-1)} disabled={quantity <= 1} />
          <Text style={[styles.quantity, { color: colors.ink }]} accessibilityLiveRegion="polite">
            {quantity}
          </Text>
          <StepButton label="+" accessibilityLabel="One more" onPress={() => change(1)} disabled={quantity >= maxQuantity} />
        </View>
        <Text style={[styles.total, { color: colors.ink }]}>
          {quantity} × {formatMoney(unitPrice)} = {formatMoney(unitPrice * quantity)}
        </Text>
        {unitPrice < product.price && (
          <Text style={[styles.hint, { color: colors.stockOk }]}>Bulk price applied</Text>
        )}
      </View>

      <TextField label="Note (optional)" value={notes} onChangeText={setNotes} maxLength={1000} />

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

      <Button label="Record sale" onPress={() => record.mutate()} loading={record.isPending} />
    </ScrollView>
  );
}

function StepButton(props: { label: string; accessibilityLabel: string; onPress: () => void; disabled: boolean }) {
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
      <Text style={[styles.stepLabel, { color: colors.ink }]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  hint: { fontFamily: fonts.body, fontSize: 15 },
  pickerRow: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1 },
  pickerName: { fontFamily: fonts.bodyBold, fontSize: 16 },
  pickerMeta: { fontFamily: fonts.body, fontSize: 14 },
  panel: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1, gap: spacing.xs },
  productName: { fontFamily: fonts.displayBold, fontSize: 26 },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, textDecorationLine: 'underline', marginTop: spacing.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 14 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, marginVertical: spacing.sm },
  stepButton: { width: 56, height: 56, borderWidth: 1, borderRadius: radius.small, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { fontFamily: fonts.bodyBold, fontSize: 28 },
  quantity: { fontFamily: fonts.displayBold, fontSize: 48, minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
  total: { fontFamily: fonts.bodyBold, fontSize: 18, fontVariant: ['tabular-nums'] },
  message: { fontFamily: fonts.bodyBold, fontSize: 15 },
});
