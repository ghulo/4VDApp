import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AnalyticsBoard } from '../components/AnalyticsBoard';
import { useSalesSeries } from '../components/useSalesSeries';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { PeriodPicker } from '../components/PeriodPicker';
import { RevenueChart } from '../components/RevenueChart';
import { analyticsApi, exportsApi, reportsApi } from '../services/api';
import { useT } from '../i18n/useT';
import { errorMessage } from '../utils/errors';
import { formatHeadlineMoney, formatMoney, formatPercent } from '../utils/format';
import { usePeriodParams } from '../utils/usePeriodParams';
import { Button, Card, DataTable, MetricCard, PageHeader } from '../components/ui';

/** Each tab of Reports is its own address; the period stays the same across them. */
export type ReportsView = 'figures' | 'team' | 'profit' | 'downloads';

export function ReportsPage({ view }: { view: ReportsView }) {
  const t = useT();
  const { period, from, to, range, rangeKey, comparedRange, changePeriod, compare, changeCompare } = usePeriodParams('this-month');
  const picker = <PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />;

  if (view !== 'figures') {
    return (
      <>
        <PageHeader
          title={t.nav.tabs[view]}
          description={t.reports.description(range.label)}
          actions={picker}
        />
        {view === 'team' && <TeamTable range={rangeKey} />}
        {view === 'profit' && <ProfitTable range={rangeKey} />}
        {view === 'downloads' && <Exports range={rangeKey} />}
      </>
    );
  }

  return (
    <>
      <PageHeader title={t.reports.title} description={t.reports.description(range.label)} />

      <AnalyticsBoard
        range={comparedRange}
        controls={
          <PeriodPicker period={period} from={from} to={to} onChange={changePeriod} compare={{ value: compare, onChange: changeCompare }} />
        }
        footer={({ current }) => (
          <>
            {range.waitingForDates && <p className="field-hint">{t.reports.waitingForDates(range.label)}</p>}
            {compare === 'last-year' && <p className="field-hint">{t.periods.comparedLastYear}</p>}
            {current.revenueWithoutCost > 0 && (
              <p className="field-hint">{t.reports.revenueWithoutCost(formatMoney(current.revenueWithoutCost))}</p>
            )}
          </>
        )}
      >
        {({ current, carwash, expenses, netProfit }) => (
          <>
            <MetricCard
              label={t.reports.carwash}
              value={formatHeadlineMoney(carwash.current.total)}
              change={carwash.change}
              hint={
                carwash.byCarwash.length > 1
                  ? carwash.byCarwash.map((row) => `${row.name} ${formatMoney(row.total)}`).join(' · ')
                  : t.reports.carwashSplit(formatMoney(carwash.current.carwash), formatMoney(carwash.current.change))
              }
              to="/carwash"
            />
            <MetricCard
              label={t.reports.together}
              value={formatHeadlineMoney(current.revenue + carwash.current.total)}
              hint={t.reports.togetherHint}
            />
            <MetricCard label={t.reports.expenses} value={formatHeadlineMoney(expenses.current)} to="/expenses" />
            <MetricCard
              label={t.reports.netProfit}
              value={formatHeadlineMoney(netProfit.current)}
              change={netProfit.change}
              hint={t.reports.netProfitHint}
            />
            <MetricCard
              label={t.analytics.margin}
              value={current.margin === null ? t.reports.unknown : formatPercent(current.margin)}
            />
            <MetricCard label={t.analytics.refunds} value={formatHeadlineMoney(current.refunds)} to="/inbox" />
            <MetricCard
              label={t.analytics.stockLosses}
              value={formatHeadlineMoney(current.stockLosses)}
              hint={current.lossUnitsWithoutCost > 0 ? t.reports.unitsWithoutCost(current.lossUnitsWithoutCost) : undefined}
              to="/inbox"
            />
            <StockWorthCard />
          </>
        )}
      </AnalyticsBoard>

      <SalesChart range={rangeKey} />
    </>
  );
}

/** What the stock on the shelves cost right now, whatever period is picked. */
function StockWorthCard() {
  const t = useT();
  const dashboard = useQuery({ queryKey: ['analytics', 'dashboard', 30], queryFn: () => analyticsApi.dashboard(30) });
  return (
    <MetricCard
      label={t.analytics.stockWorth}
      value={dashboard.data ? formatHeadlineMoney(dashboard.data.inventoryValue) : '–'}
      to="/inventory"
    />
  );
}

function SalesChart({ range }: { range: { startDate: string; endDate: string } }) {
  const t = useT();
  const series = useSalesSeries(range);
  return (
    <Card>
      {series.isPending && <Loading />}
      {series.isError && <ErrorNotice error={series.error} onRetry={() => series.refetch()} />}
      {series.data && <RevenueChart points={series.data.points} title={t.reports.salesPerDay} />}
    </Card>
  );
}

function TeamTable({ range }: { range: { startDate: string; endDate: string } }) {
  const t = useT();
  const team = useQuery({
    queryKey: ['reports', 'team', range],
    queryFn: () => reportsApi.team(range),
    placeholderData: keepPreviousData,
  });

  return (
    <Card title={t.reports.team} flush>
      {team.isPending && <Loading />}
      {team.isError && <ErrorNotice error={team.error} onRetry={() => team.refetch()} />}
      {team.data && (
        <DataTable
          caption={t.reports.team}
          rows={team.data}
          rowKey={(person) => person.userId}
          rowClassName={(person) => (person.salesCount === 0 ? 'table__row--muted' : undefined)}
          empty={<EmptyState title={t.reports.noTeam} />}
          columns={[
            {
              header: t.reports.person,
              title: true,
              cell: (person) => (
                <>
                  <span className="table__primary-link">{person.name}</span>
                  <span className="table__secondary">
                    {person.hasLeft ? t.reports.hasLeft(t.common.roles[person.role]) : t.common.roles[person.role]}
                  </span>
                </>
              ),
            },
            { header: t.reports.sales, align: 'end', cell: (person) => person.salesCount },
            { header: t.reports.units, align: 'end', cell: (person) => person.unitsSold },
            {
              header: t.reports.revenue,
              align: 'end',
              cell: (person) => (
                <>
                  {formatMoney(person.revenue)}
                  {person.monthlyTarget !== null && (
                    <span className="table__secondary">{t.reports.target(formatMoney(person.monthlyTarget))}</span>
                  )}
                </>
              ),
            },
            { header: t.reports.refunds, align: 'end', cell: (person) => formatMoney(person.refunds) },
            { header: t.reports.profit, align: 'end', cell: (person) => formatMoney(person.profit) },
            {
              header: t.reports.averageSale,
              align: 'end',
              cell: (person) => (person.salesCount === 0 ? '–' : formatMoney(person.averageSale)),
            },
            {
              header: t.reports.commission,
              align: 'end',
              cell: (person) => (
                <>
                  {person.commission === null ? '–' : formatMoney(person.commission)}
                  {person.commissionPercent !== null && (
                    <span className="table__secondary">{t.reports.ofRevenue(person.commissionPercent)}</span>
                  )}
                </>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}

function ProfitTable({ range }: { range: { startDate: string; endDate: string } }) {
  const t = useT();
  const [groupBy, setGroupBy] = useState<'product' | 'category'>('product');
  const profit = useQuery({
    queryKey: ['reports', 'profit', range, groupBy],
    queryFn: () => reportsApi.profit(range, groupBy),
    placeholderData: keepPreviousData,
  });

  return (
    <Card
      title={t.reports.profitBy[groupBy]}
      actions={
        <div className="segmented segmented--small" role="radiogroup" aria-label={t.reports.groupProfitBy}>
          {(['product', 'category'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={groupBy === option}
              className="segmented__option"
              onClick={() => setGroupBy(option)}
            >
              {option === 'product' ? t.reports.products : t.reports.categories}
            </button>
          ))}
        </div>
      }
      flush
    >
      {profit.isPending && <Loading />}
      {profit.isError && <ErrorNotice error={profit.error} onRetry={() => profit.refetch()} />}
      {profit.data && (
        <DataTable
          caption={t.reports.profitBy[groupBy]}
          rows={profit.data}
          rowKey={(row) => row.id}
          empty={<EmptyState title={t.reports.noSales} />}
          columns={[
            {
              header: groupBy === 'product' ? t.reports.product : t.reports.category,
              title: true,
              cell: (row) => (
                <>
                  {row.name}
                  {row.hasUnknownCost && <span className="table__secondary">{t.reports.noCostPrice}</span>}
                </>
              ),
            },
            { header: t.reports.units, align: 'end', cell: (row) => row.unitsSold },
            { header: t.reports.revenue, align: 'end', cell: (row) => formatMoney(row.revenue) },
            { header: t.reports.cost, align: 'end', cell: (row) => formatMoney(row.cost) },
            { header: t.reports.profit, align: 'end', cell: (row) => formatMoney(row.profit) },
            {
              header: t.reports.margin,
              align: 'end',
              cell: (row) => (row.margin === null ? t.reports.unknown : formatPercent(row.margin)),
            },
          ]}
        />
      )}
    </Card>
  );
}

function Exports({ range }: { range: { startDate: string; endDate: string } }) {
  const t = useT();
  const download = useMutation({
    mutationFn: (kind: 'sales' | 'stock' | 'team' | 'money' | 'expenses') => exportsApi.download(kind, kind === 'stock' ? undefined : range),
  });

  return (
    <Card title={t.reports.download} description={t.reports.forAccountantHint}>
      <div className="form-actions">
        <Button onClick={() => download.mutate('money')} disabled={download.isPending}>
          {t.reports.moneyPerDay}
        </Button>
        <Button onClick={() => download.mutate('expenses')} disabled={download.isPending}>
          {t.reports.expensesList}
        </Button>
        <Button onClick={() => download.mutate('sales')} disabled={download.isPending}>
          {t.reports.salesInPeriod}
        </Button>
        <Button onClick={() => download.mutate('team')} disabled={download.isPending}>
          {t.reports.teamReport}
        </Button>
        <Button onClick={() => download.mutate('stock')} disabled={download.isPending}>
          {t.reports.currentStock}
        </Button>
      </div>
      {download.isError && (
        <p className="form-error" role="alert">
          {errorMessage(download.error)}
        </p>
      )}
    </Card>
  );
}
