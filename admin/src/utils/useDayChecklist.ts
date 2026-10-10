import { useQuery } from '@tanstack/react-query';
import { dayApi } from '../services/api';

/** Under ['cash'], so saving a count anywhere ticks its step off at once. */
export const dayKey = (date?: string) => ['cash', 'day', date ?? 'today'] as const;

/** One shop day's steps (today when `date` is left out), checked again every minute while shown. */
export function useDayChecklist(date?: string) {
  return useQuery({ queryKey: dayKey(date), queryFn: () => dayApi.get(date), staleTime: 0, refetchInterval: 60_000 });
}
