import { useQuery } from '@tanstack/react-query';
import { businessApi } from '../services/api';

/**
 * What this business has set up, from the business details every page loads:
 * a carwash, TREFIN's history. Screens leave out what doesn't apply. While the
 * details load (Layout loads them first, so rarely) both read false: nothing leaks into a shop without them.
 */
export function useSetUp(): { carwash: boolean; trefin: boolean; since: Date | null } {
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });
  return {
    carwash: business.data?.hasCarwash ?? false,
    trefin: business.data?.hasTrefin ?? false,
    // When the business was added; null while loading (then nothing is cut).
    since: business.data?.createdAt ? new Date(business.data.createdAt) : null,
  };
}
