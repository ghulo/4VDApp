import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { productsApi } from '../services/api';

/** How many matches a picker lists; more are found by typing more. */
export const PICKER_SHOWN = 30;
/** The pause in typing before the server is asked. */
const PAUSE_MS = 250;

/** The value once it has stayed the same for a short pause (typing, not every key). */
export function useDebounced<T>(value: T, ms = PAUSE_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Products matching the typed words, searched by the server, so a shop with
 * thousands of products finds every one (not just the first hundred).
 * `settled` says the items are the answer for exactly `text`, nothing pending.
 */
export function useProductSearch(text: string, { inStock, limit = PICKER_SHOWN }: { inStock?: boolean; limit?: number } = {}) {
  const words = useDebounced(text.trim());
  const query = useQuery({
    queryKey: ['products', 'search', { words, inStock: inStock ?? null, limit }],
    queryFn: () => productsApi.list({ page: 1, limit, search: words || undefined, inStock }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const current = words === text.trim() && !query.isPlaceholderData;
  return {
    items: query.data?.items ?? [],
    total: query.data?.meta.total ?? 0,
    searching: !current || query.isFetching,
    settled: current && !query.isFetching && query.isSuccess,
    error: query.error,
  };
}

