import { ArrowClockwise } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { type ComparedRange, reportsApi } from '../services/api';
import type { RevenuePoint, ReportSummary } from '../services/types';
import { formatMoney } from '../utils/format';
import { ErrorNotice, Loading } from './Feedback';
import { useSalesSeries } from './useSalesSeries';
import { Button, MetricCard, MetricGrid } from './ui';

interface AnalyticsBoardProps {
  range: ComparedRange;
  /** The period picker, shown next to the refresh button. */
  controls: ReactNode;
  /** More cards after the four money cards, given the loaded figures. */
  children?: (summary: ReportSummary) => ReactNode;
  /** Shown under the grid, given the loaded figures. */
  footer?: (summary: ReportSummary) => ReactNode;
}

/**
 * The figures for a period as cards: revenue, profit, sales and items sold,
 * each with its change on the period before and a mini graph per day.
 */
export function AnalyticsBoard({ range, controls, children, footer }: AnalyticsBoardProps) {
  const t = useT();
  const summary = useQuery({
    queryKey: ['reports', 'summary', range],
    queryFn: () => reportsApi.summary(range),
    placeholderData: keepPreviousData,
  });
  const series = useSalesSeries(range);
  const isRefreshing = summary.isFetching || series.isFetching;

  function refresh() {
    void summary.refetch();
    void series.refetch();
  }

  // The graphs are extra: if only they fail, the figures still show, with "No data" graphs.
  const points = series.data?.points ?? [];
  const graph = (pick: (point: RevenuePoint) => number) => points.map(pick);
  const current = summary.data?.current;
  const change = summary.data?.change;

  return (
    <section className="board" aria-labelledby="analytics-title" aria-busy={isRefreshing}>
      <div className="board-head">
        <h2 id="analytics-title" className="board-head__title">
          {t.analytics.title}
        </h2>
        <div className="board-head__controls">
          {controls}
          <Button
            icon={ArrowClockwise}
            aria-label={isRefreshing ? t.analytics.refreshing : t.analytics.refresh}
            onClick={refresh}
            disabled={isRefreshing}
            className={isRefreshing ? 'board-head__refresh is-busy' : 'board-head__refresh'}
          />
        </div>
      </div>

      {summary.isPending && <Loading />}
      {summary.isError && <ErrorNotice error={summary.error} onRetry={refresh} />}
      {current && change && summary.data && (
        <>
          <MetricGrid>
            <MetricCard
              large
              label={t.analytics.revenue}
              value={formatMoney(current.revenue)}
              change={change.revenue}
              series={graph((point) => point.revenue)}
              to="/sales"
            />
            <MetricCard
              large
              label={t.analytics.profit}
              value={formatMoney(current.profit)}
              change={change.profit}
              series={graph((point) => point.profit)}
              to="/reports"
            />
            <MetricCard
              label={t.analytics.sales}
              value={current.salesCount}
              change={change.salesCount}
              series={graph((point) => point.salesCount)}
              to="/sales"
            />
            <MetricCard
              label={t.analytics.itemsSold}
              value={current.unitsSold}
              change={change.unitsSold}
              series={graph((point) => point.unitsSold)}
              to="/products"
            />
            {children?.(summary.data)}
          </MetricGrid>
          {footer?.(summary.data)}
        </>
      )}
    </section>
  );
}
