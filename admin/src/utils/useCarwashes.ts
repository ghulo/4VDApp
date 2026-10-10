import { useQuery } from '@tanstack/react-query';
import { carwashApi } from '../services/api';

/**
 * The open carwashes. `several` is true once there are two or more: until then
 * the screens say just "carwash" and never ask which one, as they always did.
 */
export function useCarwashes() {
  const query = useQuery({ queryKey: ['carwash', 'places'], queryFn: () => carwashApi.places(), staleTime: 60_000 });
  const places = query.data ?? [];
  return { ...query, places, several: places.length > 1 };
}

/** "Carwash" with one carwash, "Carwash (Prishtina)" with several. */
export const carwashLabel = (word: string, name: string | null, several: boolean) => {
  if (!several || !name) return word;
  // "Carwash Prishtina" already says what it is; "Carwash (Carwash Prishtina)" would repeat it.
  return name.toLowerCase().includes(word.toLowerCase()) ? name : `${word} (${name})`;
};
