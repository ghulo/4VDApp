import { Package } from 'phosphor-react-native/src/icons/Package';
import { Star } from 'phosphor-react-native/src/icons/Star';
import { type RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ProductCard } from '../components/ProductCard';
import { Button, EmptyState, ErrorState, Loading } from '../components/ui';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import { categoriesApi, favoritesApi, productsApi } from '../services/api';
import type { Product } from '../services/types';
import { fonts, radius, spacing, useThemeColors, type } from '../theme';
import { useT } from '../i18n/useT';
import { TabBarSpacer } from '../components/TabBarSpace';

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
  // Favourites are a filter here, not a tab of their own (DESIGN.md 3.2).
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  // From Home's "Something happened": tapping a product reports damage or an expiry date instead of opening it.
  const then = route.params?.then;

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

  const favourites = useQuery({ queryKey: ['favorites', 'list'], queryFn: favoritesApi.list, enabled: favouritesOnly });
  const shown = favouritesOnly ? favourites : products;
  const needle = search.toLowerCase();
  const items = favouritesOnly
    ? (favourites.data ?? []).filter(
        (product) =>
          (!needle || product.name.toLowerCase().includes(needle) || product.sku?.toLowerCase().includes(needle)) &&
          (!inStockOnly || product.stock.isInStock),
      )
    : (products.data?.pages.flatMap((page) => page.items) ?? []);
  const isFiltered = Boolean(search || categoryId || inStockOnly);

  function open(product: Product) {
    if (then === 'writeOff') {
      navigation.setParams({ then: undefined } as never);
      navigation.navigate('WriteOff', { productId: product.id, productName: product.name, inStock: product.stock.quantity });
    } else if (then === 'expiry') {
      navigation.setParams({ then: undefined } as never);
      navigation.navigate('Expiry', { productId: product.id, productName: product.name });
    } else {
      navigation.navigate('ProductDetail', { productId: product.id, name: product.name });
    }
  }

  return (
    <View style={styles.screen}>
      {then && (
        <View style={[styles.pick, { backgroundColor: colors.fill, borderBottomColor: colors.line }]}>
          <Text style={[styles.pickText, { color: colors.ink }]} accessibilityRole="header">
            {t.catalog.pickFor[then]}
          </Text>
          <Button variant="quiet" label={t.catalog.cancelPick} onPress={() => navigation.setParams({ then: undefined } as never)} />
        </View>
      )}
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
          <Chip
            label={t.catalog.favourites}
            isSelected={favouritesOnly}
            onPress={() => {
              setFavouritesOnly(!favouritesOnly);
              setCategoryId(undefined);
            }}
          />
          <Chip
            label={t.catalog.all}
            isSelected={!favouritesOnly && categoryId === undefined}
            onPress={() => {
              setFavouritesOnly(false);
              setCategoryId(undefined);
            }}
          />
          {categories.data?.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              isSelected={!favouritesOnly && categoryId === category.id}
              onPress={() => {
                setFavouritesOnly(false);
                setCategoryId(category.id === categoryId ? undefined : category.id);
              }}
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

      {shown.isPending ? (
        <Loading />
      ) : shown.isError ? (
        <ErrorState error={shown.error} onRetry={() => shown.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(product) => String(product.id)}
          contentContainerStyle={items.length === 0 ? styles.emptyList : styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => (
            <ProductCard product={item} onPress={() => open(item)} />
          )}
          onEndReached={() => !favouritesOnly && products.hasNextPage && !products.isFetchingNextPage && products.fetchNextPage()}
          onEndReachedThreshold={0.5}
          refreshing={shown.isRefetching && !products.isFetchingNextPage}
          onRefresh={() => shown.refetch()}
          ListEmptyComponent={
            favouritesOnly && !search && !inStockOnly ? (
              <EmptyState icon={Star} title={t.catalog.noFavourites}>
                {t.catalog.noFavouritesHint}
              </EmptyState>
            ) : (
              <EmptyState icon={Package} title={isFiltered ? t.catalog.nothingMatches : t.catalog.noneYet}>
                {isFiltered ? t.catalog.tryAnother : t.catalog.addedInDashboard}
              </EmptyState>
            )
          }
          ListFooterComponent={
            <>
              {products.isFetchingNextPage && <Loading />}
              <TabBarSpacer />
            </>
          }
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
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  pickText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.body },
  filters: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs, borderBottomWidth: 1 },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.small,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: type.input,
  },
  chips: { gap: spacing.sm, paddingVertical: spacing.md },
  chip: { paddingHorizontal: spacing.md, minHeight: 36, justifyContent: 'center', borderRadius: 18, borderWidth: 1 },
  chipLabel: { fontFamily: fonts.bodyBold, fontSize: type.label },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.xs },
  toggleLabel: { fontFamily: fonts.body, fontSize: type.body },
  list: { padding: spacing.lg },
  emptyList: { flexGrow: 1 },
});
