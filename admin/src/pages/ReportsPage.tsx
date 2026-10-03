import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { PeriodPicker } from '../components/PeriodPicker';
import { exportsApi, reportsApi } from '../services/api';
import { useT } from '../i18n/useT';
import type { ReportSummary } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney, formatPercent } from '../utils/format';
import type { Catalogue } from '../i18n/en';
import { type PeriodKey, resolvePeriod } from '../utils/periods';
import { Button, Card, PageHeader } from '../components/ui';

function describeChange(t: Catalogue, change: number | null): string {
  if (change === null) return t.reports.nothingToCompare;
  if (change === 0) return t.reports.sameAsBefore;
  return t.reports.change({ up: change > 0, percent: formatPercent(Math.abs(change)) });
}

export function ReportsPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const period = (params.get('period') as PeriodKey | null) ?? 'this-month';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  // Work the range out once per selection: ranges ending "now" must not
  // change on every render, or the queries below would refetch in a loop.
  const range = useMemo(() => resolvePeriod(period, { from, to }, undefined, t), [period, from, to, t]);
  const rangeKey = useMemo(() => ({ startDate: range.startDate, endDate: range.endDate }), [range]);
  const comparedRange = useMemo(
    () => ({ ...rangeKey, previousStartDate: range.previousStartDate, previousEndDate: range.previousEndDate }),
    [range, rangeKey],
  );

  const summary = useQuery({
    queryKey: ['reports', 'summary', comparedRange],
    queryFn: () => reportsApi.summary(comparedRange),
    placeholderData: keepPreviousData,
  });

  function changePeriod(next: { period: PeriodKey; from: string; to: string }) {
    const nextParams = new URLSearchParams();
    nextParams.set('period', next.period);
    if (next.period === 'custom') {
      if (next.from) nextParams.set('from', next.from);
      if (next.to) nextParams.set('to', next.to);
    }
    setParams(nextParams, { replace: true });
  }

  return (
    <>
      <PageHeader title={t.reports.title} description={t.reports.description(range.label)} />

      <PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />
      {range.waitingForDates && (
        <p className="field-hint">{t.reports.waitingForDates(range.label)}</p>
      )}

      <Card title={t.reports.money}>
        {summary.isPending && <Loading />}
        {summary.isError && <ErrorNotice error={summary.error} onRetry={() => summary.refetch()} />}
        {summary.data && <SummaryFigures summary={summary.data} />}
      </Card>

      <TeamTable range={rangeKey} />
      <ProfitTable range={rangeKey} />
      <Exports range={rangeKey} />
    </>
  );
}

function SummaryFigures({ summary }: { summary: ReportSummary }) {
  const t = useT();
  const { current, change } = summary;
  return (
    <>
      <div className="summary">
        <div className="summary__hero">
          <span className="summary__hero-value">{formatMoney(current.revenue)}</span>
          <span className="summary__label">{t.reports.inSales(describeChange(t, change.revenue))}</span>
        </div>
        <dl className="summary__figures">
          <div>
            <dt>{t.reports.profit}</dt>
            <dd>{formatMoney(current.profit)}</dd>
            <dd className="summary__change">{describeChange(t, change.profit)}</dd>
          </div>
          <div>
            <dt>{t.reports.margin}</dt>
            <dd>{current.margin === null ? t.reports.unknown : formatPercent(current.margin)}</dd>
          </div>
          <div>
            <dt>{t.reports.refunds}</dt>
            <dd>{formatMoney(current.refunds)}</dd>
          </div>
          <div>
            <dt>{t.reports.stockLosses}</dt>
            <dd>{formatMoney(current.stockLosses)}</dd>
            {current.lossUnitsWithoutCost > 0 && (
              <dd className="summary__change">{t.reports.unitsWithoutCost(current.lossUnitsWithoutCost)}</dd>
            )}
          </div>
          <div>
            <dt>{t.reports.unitsSold}</dt>
            <dd>{current.unitsSold}</dd>
            <dd className="summary__change">{describeChange(t, change.unitsSold)}</dd>
          </div>
        </dl>
      </div>
      {current.revenueWithoutCost > 0 && (
        <p className="field-hint">
          {t.reports.revenueWithoutCost(formatMoney(current.revenueWithoutCost))}
        </p>
      )}
    </>
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
          <table className="table">
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
                  <td className="table__numeric">{person.salesCount}</td>
                  <td className="table__numeric">{person.unitsSold}</td>
                  <td className="table__numeric">
                    {formatMoney(person.revenue)}
                    {person.monthlyTarget !== null && (
                      <span className="table__secondary">{t.reports.target(formatMoney(person.monthlyTarget))}</span>
                    )}
                  </td>
                  <td className="table__numeric">{formatMoney(person.refunds)}</td>
                  <td className="table__numeric">{formatMoney(person.profit)}</td>
                  <td className="table__numeric">{person.salesCount === 0 ? '–' : formatMoney(person.averageSale)}</td>
                  <td className="table__numeric">
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
          <table className="table">
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
                  <td className="table__numeric">{row.unitsSold}</td>
                  <td className="table__numeric">{formatMoney(row.revenue)}</td>
                  <td className="table__numeric">{formatMoney(row.cost)}</td>
                  <td className="table__numeric">{formatMoney(row.profit)}</td>
                  <td className="table__numeric">{row.margin === null ? t.reports.unknown : formatPercent(row.margin)}</td>
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
