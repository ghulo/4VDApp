import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { brandApi } from '../services/api';
import type { Brand } from '../services/types';
import { clearBrand, showBrand } from './applyBrand';

/**
 * A sign-in page opened from a business's own link (4vd.app/login?b=<short>):
 * that business's name, mark and colours, shown but not remembered. Without
 * the link the page is 4VD's own, in amber.
 */
export function useLinkBrand(): Brand | undefined {
  const { search } = useLocation();
  const shortName = new URLSearchParams(search).get('b')?.trim().toLowerCase() || null;
  const brand = useQuery({
    queryKey: ['brand', shortName],
    queryFn: () => brandApi.get(shortName!),
    enabled: shortName !== null && /^[a-z0-9-]{3,30}$/.test(shortName),
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (brand.data) showBrand(brand.data);
    else if (shortName === null || brand.isError) clearBrand();
  }, [brand.data, brand.isError, shortName]);
  return brand.data;
}
