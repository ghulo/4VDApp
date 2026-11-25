import { ArrowClockwise } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { type ComparedRange, reportsApi } from '../services/api';
import type { ReportSummary } from '../services/types';
import { formatHeadlineMoney } from '../utils/format';
import { ErrorNotice, Loading } from './Feedback';
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
 * each with its change on the period before. Extra tiles (children) follow on
 * the same panel; the trend per day is the page's own chart, not mini graphs.
 */
export function AnalyticsBoard({ range, controls, children, footer }: AnalyticsBoardProps) {
  const t = useT();
  const summary = useQuery({
    queryKey: ['reports', 'summary', range],
    queryFn: () => reportsApi.summary(range),
    placeholderData: keepPreviousData,
  });
  const isRefreshing = summary.isFetching;

  function refresh() {
    void summary.refetch();
  }

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
              label={t.analytics.revenue}
              value={formatHeadlineMoney(current.revenue)}
              change={change.revenue}
              to="/sales"
            />
            <MetricCard
              label={t.analytics.profit}
              value={formatHeadlineMoney(current.profit)}
              change={change.profit}
              to="/reports"
            />
            <MetricCard
              label={t.analytics.sales}
              value={current.salesCount}
              change={change.salesCount}
              to="/sales"
            />
            <MetricCard
              label={t.analytics.itemsSold}
              value={current.unitsSold}
              change={change.unitsSold}
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
