import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Product } from '../services/types';
import { fonts, spacing, useThemeColors, type } from '../theme';
import { formatMoney, promotionLabel } from '../utils/format';
import { ProductPhoto } from './ProductPhoto';
import { StockTag } from './StockTag';

interface ProductCardProps {
  product: Product;
  onPress: () => void;
}

/**
 * One row of the product list: photo, name, then category and price on one line,
 * with the shelf count on the right. Rows share one raised surface (the list draws
 * it), so a row is only a pressable band. Bulk prices wait on the product page.
 */
export function ProductCard({ product, onPress }: ProductCardProps) {
  const colors = useThemeColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatMoney(product.promotion?.price ?? product.price)}${product.promotion ? `, ${promotionLabel(product.promotion)}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: colors.surfaceSunk },
      ]}
    >
      <ProductPhoto uri={product.imageUrl} size={48} />
      <View style={styles.details}>
        <Text style={[styles.name, { color: colors.ink }]} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={[styles.meta, { color: colors.steel }]} numberOfLines={1}>
          {product.category.name} ·{' '}
          <Text style={[styles.price, { color: colors.ink }]}>{formatMoney(product.promotion?.price ?? product.price)}</Text>
          {product.promotion && ' '}
          {product.promotion && <Text style={styles.wasPrice}>{formatMoney(product.price)}</Text>}
        </Text>
        {product.promotion && <Text style={[styles.promotion, { color: colors.ok }]}>{promotionLabel(product.promotion)}</Text>}
      </View>
      <StockTag quantity={product.stock.quantity} reorderLevel={product.stock.reorderLevel} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 64,
  },
  details: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodyBold, fontSize: type.body },
  meta: { fontFamily: fonts.body, fontSize: type.label },
  price: { fontFamily: fonts.bodyBold, fontVariant: ['tabular-nums'] },
  wasPrice: { textDecorationLine: 'line-through' },
  promotion: { fontFamily: fonts.bodyBold, fontSize: type.caption },
});
