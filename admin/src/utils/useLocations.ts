import { useQuery } from '@tanstack/react-query';
import { locationsApi } from '../services/api';

/**
 * Where stock is kept. `several` is true once there are two or more: until
 * then no screen shows a location or asks which one, as it always was.
 */
export function useLocations() {
  const query = useQuery({ queryKey: ['locations'], queryFn: locationsApi.list, staleTime: 60_000 });
  const locations = query.data ?? [];
  return {
    ...query,
    locations,
    several: locations.length > 1,
    selling: locations.find((location) => location.sellsHere) ?? null,
    receiving: locations.find((location) => location.receivesHere) ?? null,
  };
}
