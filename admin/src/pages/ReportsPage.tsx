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
import { formatMoney, formatPercent } from '../utils/format';
import { usePeriodParams } from '../utils/usePeriodParams';
import { Button, Card, MetricCard, PageHeader } from '../components/ui';

export function ReportsPage() {
  const t = useT();
  const { period, from, to, range, rangeKey, comparedRange, changePeriod } = usePeriodParams('this-month');

  return (
    <>
      <PageHeader title={t.reports.title} description={t.reports.description(range.label)} />

      <AnalyticsBoard
        range={comparedRange}
        controls={<PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />}
        footer={({ current }) => (
          <>
            {range.waitingForDates && <p className="field-hint">{t.reports.waitingForDates(range.label)}</p>}
            {current.revenueWithoutCost > 0 && (
              <p className="field-hint">{t.reports.revenueWithoutCost(formatMoney(current.revenueWithoutCost))}</p>
            )}
          </>
        )}
      >
        {({ current, carwash }) => (
          <>
            <MetricCard
              label={t.reports.carwash}
              value={formatMoney(carwash.current.total)}
              change={carwash.change}
              hint={t.reports.carwashSplit(formatMoney(carwash.current.carwash), formatMoney(carwash.current.change))}
              to="/carwash"
            />
            <MetricCard
              label={t.reports.together}
              value={formatMoney(current.revenue + carwash.current.total)}
              hint={t.reports.togetherHint}
            />
            <MetricCard
              label={t.analytics.margin}
              value={current.margin === null ? t.reports.unknown : formatPercent(current.margin)}
            />
            <MetricCard label={t.analytics.refunds} value={formatMoney(current.refunds)} to="/approvals" />
            <MetricCard
              label={t.analytics.stockLosses}
              value={formatMoney(current.stockLosses)}
              hint={current.lossUnitsWithoutCost > 0 ? t.reports.unitsWithoutCost(current.lossUnitsWithoutCost) : undefined}
              to="/approvals"
            />
            <StockWorthCard />
          </>
        )}
      </AnalyticsBoard>

      <SalesChart range={rangeKey} />
      <TeamTable range={rangeKey} />
      <ProfitTable range={rangeKey} />
      <Exports range={rangeKey} />
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
      value={dashboard.data ? formatMoney(dashboard.data.inventoryValue) : '–'}
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
    <Card title={t.reports.team}>
      {team.isPending && <Loading />}
      {team.isError && <ErrorNotice error={team.error} onRetry={() => team.refetch()} />}
      {team.data && team.data.length === 0 && <EmptyState title={t.reports.noTeam} />}
      {team.data && team.data.length > 0 && (
        <div className="table-wrap">
          <table className="table table--stack">
            <thead>
              <tr>
                <th scope="col">{t.reports.person}</th>
                <th scope="col" className="table__numeric">{t.reports.sales}</th>
                <th scope="col" className="table__numeric">{t.reports.units}</th>
                <th scope="col" className="table__numeric">{t.reports.revenue}</th>
                <th scope="col" className="table__numeric">{t.reports.refunds}</th>
                <th scope="col" className="table__numeric">{t.reports.profit}</th>
                <th scope="col" className="table__numeric">{t.reports.averageSale}</th>
                <th scope="col" className="table__numeric">{t.reports.commission}</th>
              </tr>
            </thead>
            <tbody>
              {team.data.map((person) => (
                <tr key={person.userId} className={person.salesCount === 0 ? 'table__row--muted' : undefined}>
                  <td>
                    <span className="table__primary-link">{person.name}</span>
                    <span className="table__secondary">
                      {person.hasLeft ? t.reports.hasLeft(t.common.roles[person.role]) : t.common.roles[person.role]}
                    </span>
                  </td>
                  <td className="table__numeric" data-label={t.reports.sales}>{person.salesCount}</td>
                  <td className="table__numeric" data-label={t.reports.units}>{person.unitsSold}</td>
                  <td className="table__numeric" data-label={t.reports.revenue}>
                    {formatMoney(person.revenue)}
                    {person.monthlyTarget !== null && (
                      <span className="table__secondary">{t.reports.target(formatMoney(person.monthlyTarget))}</span>
                    )}
                  </td>
                  <td className="table__numeric" data-label={t.reports.refunds}>{formatMoney(person.refunds)}</td>
                  <td className="table__numeric" data-label={t.reports.profit}>{formatMoney(person.profit)}</td>
                  <td className="table__numeric" data-label={t.reports.averageSale}>{person.salesCount === 0 ? '–' : formatMoney(person.averageSale)}</td>
                  <td className="table__numeric" data-label={t.reports.commission}>
                    {person.commission === null ? '–' : formatMoney(person.commission)}
                    {person.commissionPercent !== null && (
                      <span className="table__secondary">{t.reports.ofRevenue(person.commissionPercent)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    >
      {profit.isPending && <Loading />}
      {profit.isError && <ErrorNotice error={profit.error} onRetry={() => profit.refetch()} />}
      {profit.data && profit.data.length === 0 && <EmptyState title={t.reports.noSales} />}
      {profit.data && profit.data.length > 0 && (
        <div className="table-wrap">
          <table className="table table--stack">
            <thead>
              <tr>
                <th scope="col">{groupBy === 'product' ? t.reports.product : t.reports.category}</th>
                <th scope="col" className="table__numeric">{t.reports.units}</th>
                <th scope="col" className="table__numeric">{t.reports.revenue}</th>
                <th scope="col" className="table__numeric">{t.reports.cost}</th>
                <th scope="col" className="table__numeric">{t.reports.profit}</th>
                <th scope="col" className="table__numeric">{t.reports.margin}</th>
              </tr>
            </thead>
            <tbody>
              {profit.data.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    {row.hasUnknownCost && <span className="table__secondary">{t.reports.noCostPrice}</span>}
                  </td>
                  <td className="table__numeric" data-label={t.reports.units}>{row.unitsSold}</td>
                  <td className="table__numeric" data-label={t.reports.revenue}>{formatMoney(row.revenue)}</td>
                  <td className="table__numeric" data-label={t.reports.cost}>{formatMoney(row.cost)}</td>
                  <td className="table__numeric" data-label={t.reports.profit}>{formatMoney(row.profit)}</td>
                  <td className="table__numeric" data-label={t.reports.margin}>{row.margin === null ? t.reports.unknown : formatPercent(row.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Exports({ range }: { range: { startDate: string; endDate: string } }) {
  const t = useT();
  const download = useMutation({
    mutationFn: (kind: 'sales' | 'stock' | 'team') => exportsApi.download(kind, kind === 'stock' ? undefined : range),
  });

  return (
    <Card title={t.reports.download}>
      <div className="form-actions">
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
