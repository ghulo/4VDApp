import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { FlatList, StyleSheet, View } from 'react-native';
import { ProductCard } from '../components/ProductCard';
import { EmptyState, ErrorState, Loading } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { favoritesApi } from '../services/api';
import { spacing, useThemeColors } from '../theme';
import { useT } from '../i18n/useT';
import { TabBarSpacer } from '../components/TabBarSpace';

export function FavoritesScreen() {
  const colors = useThemeColors();
  const t = useT();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const favorites = useQuery({ queryKey: ['favorites', 'list'], queryFn: favoritesApi.list });

  if (favorites.isPending) return <Loading />;
  if (favorites.isError) return <ErrorState error={favorites.error} onRetry={() => favorites.refetch()} />;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <FlatList
        data={favorites.data}
        keyExtractor={(product) => String(product.id)}
        contentContainerStyle={favorites.data.length === 0 ? styles.emptyList : styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListFooterComponent={TabBarSpacer}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            onPress={() => navigation.navigate('ProductDetail', { productId: item.id, name: item.name })}
          />
        )}
        refreshing={favorites.isRefetching}
        onRefresh={() => favorites.refetch()}
        ListEmptyComponent={
          <EmptyState title={t.favorites.none}>{t.favorites.noneHint}</EmptyState>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: spacing.lg },
  emptyList: { flexGrow: 1 },
});
