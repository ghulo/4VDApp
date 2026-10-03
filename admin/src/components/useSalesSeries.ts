import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../services/api';
import type { RevenueSeries } from '../services/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Daily points for up to four months, weekly beyond that, so a mini graph stays readable. */
function seriesPeriod(range: { startDate: string; endDate: string }): RevenueSeries['period'] {
  const days = (new Date(range.endDate).getTime() - new Date(range.startDate).getTime()) / MS_PER_DAY;
  return days <= 120 ? 'daily' : days <= 5 * 365 ? 'weekly' : 'monthly';
}

/** Sales per day (or week) over a range; the cards' mini graphs and the Reports chart share it. */
export function useSalesSeries(range: { startDate: string; endDate: string }) {
  const period = seriesPeriod(range);
  return useQuery({
    queryKey: ['analytics', 'revenue', period, range.startDate, range.endDate],
    queryFn: () => analyticsApi.revenue(period, range.startDate, range.endDate),
    placeholderData: keepPreviousData,
  });
}
