import { Image } from 'expo-image';
import { mediaSrc } from '../services/apiClient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Product } from '../services/types';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { formatMoney, promotionLabel } from '../utils/format';
import { StockTag } from './StockTag';
import { useT } from '../i18n/useT';

interface ProductCardProps {
  product: Product;
  onPress: () => void;
}

export function ProductCard({ product, onPress }: ProductCardProps) {
  const colors = useThemeColors();
  const t = useT();
  const cheapestTier = product.bulkPricingTiers.at(-1);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatMoney(product.promotion?.price ?? product.price)}${product.promotion ? `, ${promotionLabel(product.promotion)}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.line, boxShadow: colors.raise },
        pressed && { backgroundColor: colors.surfaceSunk, boxShadow: colors.inset },
      ]}
    >
      {product.imageUrl ? (
        <Image source={mediaSrc(product.imageUrl)} style={styles.image} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.image, styles.imagePlaceholder, { backgroundColor: colors.background }]}>
          <Text style={[styles.placeholderInitial, { color: colors.steel }]}>{product.name.charAt(0)}</Text>
        </View>
      )}
      <View style={styles.details}>
        <Text style={[styles.name, { color: colors.ink }]} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={[styles.category, { color: colors.steel }]}>{product.category.name}</Text>
        {product.promotion ? (
          <>
            <Text style={[styles.price, { color: colors.ink }]}>
              {formatMoney(product.promotion.price)}{' '}
              <Text style={[styles.wasPrice, { color: colors.steel }]}>{formatMoney(product.price)}</Text>
            </Text>
            <Text style={[styles.promotion, { color: colors.stockOk }]}>{promotionLabel(product.promotion)}</Text>
          </>
        ) : (
          <Text style={[styles.price, { color: colors.ink }]}>{formatMoney(product.price)}</Text>
        )}
        {cheapestTier && (
          <Text style={[styles.bulk, { color: colors.steel }]}>
            {t.product.bulkFrom(formatMoney(cheapestTier.price), cheapestTier.quantity)}
          </Text>
        )}
      </View>
      <StockTag quantity={product.stock.quantity} reorderLevel={product.stock.reorderLevel} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.panel,
  },
  image: { width: 64, height: 64, borderRadius: radius.small },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderInitial: { fontFamily: fonts.displayBold, fontSize: 28 },
  details: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16 },
  category: { fontFamily: fonts.body, fontSize: 13 },
  price: { fontFamily: fonts.bodyBold, fontSize: 16, marginTop: 2 },
  bulk: { fontFamily: fonts.body, fontSize: 13 },
  wasPrice: { fontFamily: fonts.body, fontSize: 14, textDecorationLine: 'line-through' },
  promotion: { fontFamily: fonts.bodyBold, fontSize: 13 },
});
