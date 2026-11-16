import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../services/api';
import type { ShopFeatures } from '../services/types';

const OFF: ShopFeatures = { projects: false, recipes: false, serials: false };

/**
 * Which rarely needed parts the shop switched on (Settings → Features). Until
 * the rules load, everything reads as off, so nothing flashes in and out.
 */
export function useFeatures(): ShopFeatures {
  const rules = useQuery({ queryKey: ['settings', 'rules'], queryFn: settingsApi.rules, staleTime: 60_000 });
  return rules.data?.features ?? OFF;
}
