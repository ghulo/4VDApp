import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { EmptyState, Loading } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { productsApi } from '../services/api';
import { useT } from '../i18n/useT';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanResult'>;

/** Opened from a product's QR code: finds the product and shows it. */
export function ScanResultScreen({ route, navigation }: Props) {
  const t = useT();
  const { code } = route.params;
  const product = useQuery({ queryKey: ['products', 'barcode', code], queryFn: () => productsApi.byBarcode(code), retry: false });

  useEffect(() => {
    if (product.data) navigation.replace('ProductDetail', { productId: product.data.id, name: product.data.name });
  }, [product.data, navigation]);

  if (product.isError) return <EmptyState art="crate" title={t.scan.notFound}>{t.scan.notFoundHint(code)}</EmptyState>;
  return <Loading />;
}
