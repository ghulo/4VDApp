import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useT } from '../i18n/useT';
import { reportsApi, type ReportRange } from '../services/api';
import type { SalesPatterns } from '../services/types';
import { formatHeadlineMoney, formatPercent } from '../utils/format';
import { ErrorNotice, Loading } from './Feedback';
import { BarList, Card, ColumnChart, EmptyState, Heatmap } from './ui';

const TOP_PRODUCTS = 10;
/** The hours shown at least, so a shop open 9 to 5 doesn't fill the chart with night. */
const MIN_HOURS = 8;

/** When sales happen, for the whole shop or one seller; shared by the charts below. */
export function usePatterns(range: ReportRange, userId?: number) {
  return useQuery({
    queryKey: ['reports', 'patterns', range, userId ?? null],
    queryFn: () => reportsApi.patterns(range, userId),
    placeholderData: keepPreviousData,
  });
}

function useProfit(range: ReportRange, groupBy: 'product' | 'category', userId?: number) {
  return useQuery({
    queryKey: ['reports', 'profit', range, groupBy, userId ?? null],
    queryFn: () => reportsApi.profit(range, groupBy, userId),
    placeholderData: keepPreviousData,
  });
}

export function WeekdaysCard({ patterns }: { patterns: SalesPatterns }) {
  const t = useT();
  return (
    <Card title={t.analysis.weekdays} description={t.analysis.weekdaysHint}>
      <ColumnChart
        label={t.analysis.weekdays}
        columns={patterns.weekdays.map((row, index) => ({
          key: row.weekday,
          label: t.analysis.weekdayShort[index]!,
          value: row.averageRevenue,
          description: t.analysis.weekdayTip(t.analysis.weekdayLong[index]!, formatHeadlineMoney(row.averageRevenue)),
        }))}
      />
    </Card>
  );
}

/** From the first hour with a sale to the last, widened to a working day when that's short. */
function openHours(patterns: SalesPatterns): [number, number] {
  const busy = patterns.hours.filter((row) => row.salesCount > 0).map((row) => row.hour);
  let first = busy.length ? Math.min(...busy) : 9;
  let last = busy.length ? Math.max(...busy) : 16;
  while (last - first + 1 < MIN_HOURS) {
    if (first > 0) first -= 1;
    if (last - first + 1 < MIN_HOURS && last < 23) last += 1;
  }
  return [first, last];
}

const clock = (hour: number) => `${String(hour % 24).padStart(2, '0')}:00`;

export function HoursCard({ patterns }: { patterns: SalesPatterns }) {
  const t = useT();
  const [first, last] = openHours(patterns);
  return (
    <Card title={t.analysis.hours} description={t.analysis.hoursHint}>
      <ColumnChart
        label={t.analysis.hours}
        columns={patterns.hours.slice(first, last + 1).map((row) => ({
          key: row.hour,
          label: String(row.hour),
          value: row.revenue,
          description: t.analysis.hourTip(clock(row.hour), clock(row.hour + 1), formatHeadlineMoney(row.revenue), row.salesCount),
        }))}
      />
    </Card>
  );
}

export function CategoriesCard({ range, userId, title }: { range: ReportRange; userId?: number; title?: string }) {
  const t = useT();
  const rows = useProfit(range, 'category', userId);
  const total = (rows.data ?? []).reduce((sum, row) => sum + Math.max(row.revenue, 0), 0);
  const sorted = [...(rows.data ?? [])].sort((a, b) => b.revenue - a.revenue);
  return (
    <Card title={title ?? t.analysis.byCategory}>
      {rows.isPending && <Loading />}
      {rows.isError && <ErrorNotice error={rows.error} onRetry={() => rows.refetch()} />}
      {rows.data &&
        (sorted.length === 0 ? (
          <EmptyState title={t.analysis.nothingYet} />
        ) : (
          <BarList
            label={title ?? t.analysis.byCategory}
            items={sorted.map((row) => ({
              key: row.id,
              label: row.name,
              value: row.revenue,
              display: formatHeadlineMoney(row.revenue),
              detail: total > 0 ? t.analysis.share(formatPercent(row.revenue / total)) : undefined,
            }))}
          />
        ))}
    </Card>
  );
}

export function TopProductsCard({ range, userId, title }: { range: ReportRange; userId?: number; title?: string }) {
  const t = useT();
  const rows = useProfit(range, 'product', userId);
  const top = [...(rows.data ?? [])].sort((a, b) => b.revenue - a.revenue).slice(0, TOP_PRODUCTS);
  return (
    <Card title={title ?? t.analysis.topProducts}>
      {rows.isPending && <Loading />}
      {rows.isError && <ErrorNotice error={rows.error} onRetry={() => rows.refetch()} />}
      {rows.data &&
        (top.length === 0 ? (
          <EmptyState title={t.analysis.nothingYet} />
        ) : (
          <BarList
            label={title ?? t.analysis.topProducts}
            items={top.map((row) => ({
              key: row.id,
              label: row.name,
              to: `/products/${row.id}`,
              value: row.revenue,
              display: formatHeadlineMoney(row.revenue),
              detail: t.analysis.productDetail(row.unitsSold, formatHeadlineMoney(row.profit)),
            }))}
          />
        ))}
    </Card>
  );
}

/** Which hours of which weekdays are busy: the average revenue of each, as a grid. */
export function BusyHoursCard({ range, userId }: { range: ReportRange; userId?: number }) {
  const t = useT();
  const patterns = usePatterns(range, userId);
  if (!patterns.data) return null;
  const [first, last] = openHours(patterns.data);
  const hours = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const days = patterns.data.weekdays.map((row) => row.days);
  const average = (weekday: number, hour: number) => {
    const cell = patterns.data.weekHours[weekday]?.[hour];
    return cell && days[weekday] ? cell.revenue / days[weekday]! : 0;
  };
  return (
    <Card title={t.analysis.busyHours} description={t.analysis.busyHoursHint}>
      <Heatmap
        label={t.analysis.busyHours}
        rows={t.analysis.weekdayShort}
        columns={hours.map((hour) => String(hour).padStart(2, '0'))}
        values={t.analysis.weekdayShort.map((_, weekday) => hours.map((hour) => average(weekday, hour)))}
        labelEvery={2}
        describe={(weekday, column) => {
          const hour = hours[column]!;
          return t.analysis.busyTip(
            t.analysis.weekdayLong[weekday]!,
            clock(hour),
            clock(hour + 1),
            formatHeadlineMoney(average(weekday, hour)),
            patterns.data.weekHours[weekday]?.[hour]?.salesCount ?? 0,
          );
        }}
      />
    </Card>
  );
}

/** Weekdays and hours side by side, for the whole shop or one seller. */
export function PatternCards({ range, userId }: { range: ReportRange; userId?: number }) {
  const patterns = usePatterns(range, userId);
  if (patterns.isPending) return <Loading />;
  if (patterns.isError) return <ErrorNotice error={patterns.error} onRetry={() => patterns.refetch()} />;
  return (
    <>
      <WeekdaysCard patterns={patterns.data} />
      <HoursCard patterns={patterns.data} />
    </>
  );
}
