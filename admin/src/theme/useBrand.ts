import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { businessApi } from '../services/api';
import type { Brand } from '../services/types';
import { applyBrand, clearBrand } from './applyBrand';
import { useTabTitle } from './useTabTitle';

/** Pages that are always 4VD's, whichever business is open (All logs is the developer's own). */
const HOUSE_PAGES = ['/all-logs'];

/**
 * The business the person works in now, in its own colours: applied to the
 * whole page and kept for the next load. Switching business refetches
 * ['business'], so the colours follow.
 */
export function useBrand(): Brand | undefined {
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });
  const { pathname } = useLocation();
  const housePage = HOUSE_PAGES.some((page) => pathname.startsWith(page));
  const brand = business.data?.brand;
  useEffect(() => {
    if (!brand) return;
    if (housePage) clearBrand(false);
    else applyBrand(brand);
  }, [brand, housePage]);
  useTabTitle(housePage || !brand || brand.house ? null : brand.name);
  return housePage ? undefined : brand;
}
