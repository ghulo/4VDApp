import { type RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ProductCard } from '../components/ProductCard';
import { EmptyState, ErrorState, Loading } from '../components/ui';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import { categoriesApi, productsApi } from '../services/api';
import { fonts, radius, spacing, useThemeColors } from '../theme';
import { useT } from '../i18n/useT';

const SEARCH_DEBOUNCE_MS = 300;

export function CatalogScreen() {
  const colors = useThemeColors();
  const t = useT();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, 'Catalog'>>();
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [inStockOnly, setInStockOnly] = useState(false);

  // A search typed on Home arrives as a route param.
  const searchFromHome = route.params?.search;
  useEffect(() => {
    if (searchFromHome !== undefined) setSearchDraft(searchFromHome);
  }, [searchFromHome]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const products = useInfiniteQuery({
    queryKey: ['products', { search, categoryId, inStockOnly }],
    queryFn: ({ pageParam }) =>
      productsApi.list({ page: pageParam, search, categoryId, inStock: inStockOnly || undefined }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta.page * lastPage.meta.limit < lastPage.meta.total ? lastPage.meta.page + 1 : undefined,
  });

  const items = products.data?.pages.flatMap((page) => page.items) ?? [];
  const isFiltered = Boolean(search || categoryId || inStockOnly);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.filters, { backgroundColor: colors.surface, borderBottomColor: colors.line }]}>
        <TextInput
          value={searchDraft}
          onChangeText={setSearchDraft}
          placeholder={t.catalog.search}
          placeholderTextColor={colors.steel}
          accessibilityLabel={t.catalog.searchLabel}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={[styles.search, { color: colors.ink, borderColor: colors.lineStrong, backgroundColor: colors.background }]}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={t.catalog.all} isSelected={categoryId === undefined} onPress={() => setCategoryId(undefined)} />
          {categories.data?.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              isSelected={categoryId === category.id}
              onPress={() => setCategoryId(category.id === categoryId ? undefined : category.id)}
            />
          ))}
        </ScrollView>
        <View style={styles.toggleRow}>
          <Text style={[styles.toggleLabel, { color: colors.ink }]}>{t.catalog.inStockOnly}</Text>
          <Switch
            value={inStockOnly}
            onValueChange={setInStockOnly}
            accessibilityLabel={t.catalog.inStockOnly}
            trackColor={{ true: colors.ink, false: colors.lineStrong }}
          />
        </View>
      </View>

      {products.isPending ? (
        <Loading />
      ) : products.isError ? (
        <ErrorState error={products.error} onRetry={() => products.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(product) => String(product.id)}
          contentContainerStyle={items.length === 0 ? styles.emptyList : styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              onPress={() => navigation.navigate('ProductDetail', { productId: item.id, name: item.name })}
            />
          )}
          onEndReached={() => products.hasNextPage && !products.isFetchingNextPage && products.fetchNextPage()}
          onEndReachedThreshold={0.5}
          refreshing={products.isRefetching && !products.isFetchingNextPage}
          onRefresh={() => products.refetch()}
          ListEmptyComponent={
            <EmptyState title={isFiltered ? t.catalog.nothingMatches : t.catalog.noneYet}>
              {isFiltered ? t.catalog.tryAnother : t.catalog.addedInDashboard}
            </EmptyState>
          }
          ListFooterComponent={products.isFetchingNextPage ? <Loading /> : null}
        />
      )}
    </View>
  );
}

function Chip({ label, isSelected, onPress }: { label: string; isSelected: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      style={[
        styles.chip,
        isSelected ? { backgroundColor: colors.selected, borderColor: colors.selected } : { borderColor: colors.lineStrong },
      ]}
    >
      <Text style={[styles.chipLabel, { color: isSelected ? colors.onSelected : colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  filters: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs, borderBottomWidth: 1 },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.small,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  chips: { gap: spacing.sm, paddingVertical: spacing.md },
  chip: { paddingHorizontal: spacing.md, minHeight: 36, justifyContent: 'center', borderRadius: 18, borderWidth: 1 },
  chipLabel: { fontFamily: fonts.bodyBold, fontSize: 14 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.xs },
  toggleLabel: { fontFamily: fonts.body, fontSize: 15 },
  list: { padding: spacing.lg },
  emptyList: { flexGrow: 1 },
});
