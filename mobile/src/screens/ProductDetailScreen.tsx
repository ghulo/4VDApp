import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { mediaSrc } from '../services/apiClient';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { StockTag } from '../components/StockTag';
import { Button, ErrorState, Loading } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { favoritesApi, productsApi } from '../services/api';
import { canRecordSales, useCurrentUser } from '../state/useAuth';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { errorMessage, formatMoney, promotionLabel } from '../utils/format';
import { useT } from '../i18n/useT';

type Props = NativeStackScreenProps<RootStackParamList, 'ProductDetail'>;

export function ProductDetailScreen({ route, navigation }: Props) {
  const t = useT();
  const { productId } = route.params;
  const colors = useThemeColors();
  const user = useCurrentUser();
  const queryClient = useQueryClient();

  const product = useQuery({ queryKey: ['products', productId], queryFn: () => productsApi.get(productId) });
  const favoriteIds = useQuery({ queryKey: ['favorites', 'ids'], queryFn: favoritesApi.ids });
  const isFavorite = favoriteIds.data?.includes(productId) ?? false;

  const toggleFavorite = useMutation({
    mutationFn: () => (isFavorite ? favoritesApi.remove(productId) : favoritesApi.add(productId)),
    // Flip the button straight away; the server catches up a moment later.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['favorites', 'ids'] });
      const previous = queryClient.getQueryData<number[]>(['favorites', 'ids']);
      queryClient.setQueryData<number[]>(['favorites', 'ids'], (ids = []) =>
        isFavorite ? ids.filter((id) => id !== productId) : [...ids, productId],
      );
      return { previous };
    },
    onError: (_error, _variables, context) => queryClient.setQueryData(['favorites', 'ids'], context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['favorites'] }),
  });

  if (product.isPending) return <Loading />;
  if (product.isError) return <ErrorState error={product.error} onRetry={() => product.refetch()} />;

  const item = product.data;
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      {item.imageUrl && (
        <Image source={mediaSrc(item.imageUrl)} style={styles.image} contentFit="cover" accessibilityIgnoresInvertColors />
      )}

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.category, { color: colors.steel }]}>
          {item.category.name}
          {item.sku ? t.product.sku(item.sku) : ''}
        </Text>
        <Text style={[styles.name, { color: colors.ink }]}>{item.name}</Text>
        <Text style={[styles.price, { color: colors.ink }]}>
          {formatMoney(item.promotion?.price ?? item.price)} <Text style={[styles.unit, { color: colors.steel }]}>{t.product.each}</Text>
          {item.promotion && (
            <Text style={[styles.wasPrice, { color: colors.steel }]}> {formatMoney(item.price)}</Text>
          )}
        </Text>
        {item.promotion && (
          <Text style={[styles.promotion, { color: colors.stockOk }]}>
            {item.promotion.name}: {promotionLabel(item.promotion)}
          </Text>
        )}
        {item.description && <Text style={[styles.description, { color: colors.ink }]}>{item.description}</Text>}
      </View>

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.panelTitle, { color: colors.ink }]}>{t.product.inStock}</Text>
        <StockTag quantity={item.stock.quantity} reorderLevel={item.stock.reorderLevel} size="large" />
      </View>

      {item.bulkPricingTiers.length > 0 && (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Text style={[styles.panelTitle, { color: colors.ink }]}>{t.product.bulkPrices}</Text>
          <TierRow quantityLabel={t.product.upTo(item.bulkPricingTiers[0]!.quantity - 1)} price={item.price} />
          {item.bulkPricingTiers.map((tier) => (
            <TierRow key={tier.quantity} quantityLabel={t.product.orMore(tier.quantity)} price={tier.price} />
          ))}
        </View>
      )}

      <View style={styles.actions}>
        {canRecordSales(user) && item.stock.isInStock && (
          <Button label={t.product.recordSale} onPress={() => navigation.navigate('RecordSale', { productId })} />
        )}
        {canRecordSales(user) && item.stock.isInStock && (
          <Button
            label={t.product.reportLoss}
            variant="quiet"
            onPress={() =>
              navigation.navigate('WriteOff', { productId, productName: item.name, inStock: item.stock.quantity })
            }
          />
        )}
        <Button
          label={isFavorite ? t.product.removeFavorite : t.product.saveFavorite}
          variant="quiet"
          onPress={() => toggleFavorite.mutate()}
          disabled={favoriteIds.isPending}
        />
        {toggleFavorite.isError && (
          <Text style={[styles.error, { color: colors.signalOut }]}>{errorMessage(toggleFavorite.error)}</Text>
        )}
      </View>
    </ScrollView>
  );
}

function TierRow({ quantityLabel, price }: { quantityLabel: string; price: number }) {
  const colors = useThemeColors();
  const t = useT();
  return (
    <View style={[styles.tierRow, { borderTopColor: colors.line }]}>
      <Text style={[styles.tierQuantity, { color: colors.ink }]}>{quantityLabel}</Text>
      <Text style={[styles.tierPrice, { color: colors.ink }]}>{t.product.eachPrice(formatMoney(price))}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  image: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.panel },
  panel: { padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1, gap: spacing.xs },
  panelTitle: { fontFamily: fonts.display, fontSize: 20, marginBottom: spacing.sm },
  category: { fontFamily: fonts.body, fontSize: 14 },
  name: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 32 },
  price: { fontFamily: fonts.bodyBold, fontSize: 22, marginTop: spacing.xs },
  wasPrice: { fontFamily: fonts.body, fontSize: 16, textDecorationLine: 'line-through' },
  promotion: { fontFamily: fonts.bodyBold, fontSize: 15 },
  unit: { fontFamily: fonts.body, fontSize: 16 },
  description: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, marginTop: spacing.sm },
  tierRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderTopWidth: 1 },
  tierQuantity: { fontFamily: fonts.body, fontSize: 16 },
  tierPrice: { fontFamily: fonts.bodyBold, fontSize: 16, fontVariant: ['tabular-nums'] },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  error: { fontFamily: fonts.bodyBold, fontSize: 14 },
});
