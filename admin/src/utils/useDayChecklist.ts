import { useQuery } from '@tanstack/react-query';
import { dayApi } from '../services/api';
import type { DayChecklist } from '../services/types';

/** Under ['cash'], so saving a count on the same page ticks it off at once. */
export const DAY_CHECKLIST_KEY = ['cash', 'checklist'] as const;

/** Today's end-of-day checklist, checked again every minute while the page is open. */
export function useDayChecklist() {
  return useQuery({ queryKey: DAY_CHECKLIST_KEY, queryFn: dayApi.today, staleTime: 0, refetchInterval: 60_000 });
}

/** How many of the day's checks are done, out of how many apply (no carwash, no carwash check). */
export function checklistProgress(day: DayChecklist) {
  const items = [day.cash.done, day.carwash?.done, day.expenses.done, day.approvals.done].filter((done) => done !== undefined);
  return { done: items.filter(Boolean).length, total: items.length };
}
