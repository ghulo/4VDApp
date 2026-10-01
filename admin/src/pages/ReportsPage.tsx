import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { PeriodPicker } from '../components/PeriodPicker';
import { exportsApi, reportsApi } from '../services/api';
import type { ReportSummary } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney, ROLE_LABEL } from '../utils/format';
import { type PeriodKey, resolvePeriod } from '../utils/periods';

const percent = new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1 });

function describeChange(change: number | null): string {
  if (change === null) return 'nothing to compare with';
  if (change === 0) return 'same as the period before';
  return `${change > 0 ? 'up' : 'down'} ${percent.format(Math.abs(change))} on the period before`;
}

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const period = (params.get('period') as PeriodKey | null) ?? 'this-month';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  // Work the range out once per selection: ranges ending "now" must not
  // change on every render, or the queries below would refetch in a loop.
  const range = useMemo(() => resolvePeriod(period, { from, to }), [period, from, to]);
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
      <header className="page-header">
        <h1 className="page-title">Reports</h1>
        <p className="page-intro">How much you sold and earned in {range.label}, and who sold it.</p>
      </header>

      <PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />
      {range.waitingForDates && (
        <p className="field-hint">Pick both a start and an end date. Until then this shows {range.label}.</p>
      )}

      <section className="panel" aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="panel__title">
          Money
        </h2>
        {summary.isPending && <Loading />}
        {summary.isError && <ErrorNotice error={summary.error} onRetry={() => summary.refetch()} />}
        {summary.data && <SummaryFigures summary={summary.data} />}
      </section>

      <TeamTable range={rangeKey} />
      <ProfitTable range={rangeKey} />
      <Exports range={rangeKey} />
    </>
  );
}

function SummaryFigures({ summary }: { summary: ReportSummary }) {
  const { current, change } = summary;
  return (
    <>
      <div className="summary">
        <div className="summary__hero">
          <span className="summary__hero-value">{formatMoney(current.revenue)}</span>
          <span className="summary__label">in sales after refunds, {describeChange(change.revenue)}</span>
        </div>
        <dl className="summary__figures">
          <div>
            <dt>Profit</dt>
            <dd>{formatMoney(current.profit)}</dd>
            <dd className="summary__change">{describeChange(change.profit)}</dd>
          </div>
          <div>
            <dt>Margin</dt>
            <dd>{current.margin === null ? 'Unknown' : percent.format(current.margin)}</dd>
          </div>
          <div>
            <dt>Refunds</dt>
            <dd>{formatMoney(current.refunds)}</dd>
          </div>
          <div>
            <dt>Stock losses</dt>
            <dd>{formatMoney(current.stockLosses)}</dd>
            {current.lossUnitsWithoutCost > 0 && (
              <dd className="summary__change">plus {current.lossUnitsWithoutCost} units without a cost price</dd>
            )}
          </div>
          <div>
            <dt>Units sold</dt>
            <dd>{current.unitsSold}</dd>
            <dd className="summary__change">{describeChange(change.unitsSold)}</dd>
          </div>
        </dl>
      </div>
      {current.revenueWithoutCost > 0 && (
        <p className="field-hint">
          {formatMoney(current.revenueWithoutCost)} of sales came from products without a cost price, so they're left out of
          profit and margin. Add cost prices on the Products page to include them.
        </p>
      )}
    </>
  );
}

function TeamTable({ range }: { range: { startDate: string; endDate: string } }) {
  const team = useQuery({
    queryKey: ['reports', 'team', range],
    queryFn: () => reportsApi.team(range),
    placeholderData: keepPreviousData,
  });

  return (
    <section className="panel" aria-labelledby="team-heading">
      <h2 id="team-heading" className="panel__title">
        Team
      </h2>
      {team.isPending && <Loading />}
      {team.isError && <ErrorNotice error={team.error} onRetry={() => team.refetch()} />}
      {team.data && team.data.length === 0 && <EmptyState title="No admins or employees yet" />}
      {team.data && team.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col" className="table__numeric">Sales</th>
                <th scope="col" className="table__numeric">Units</th>
                <th scope="col" className="table__numeric">Revenue</th>
                <th scope="col" className="table__numeric">Refunds</th>
                <th scope="col" className="table__numeric">Profit</th>
                <th scope="col" className="table__numeric">Average sale</th>
              </tr>
            </thead>
            <tbody>
              {team.data.map((person) => (
                <tr key={person.userId} className={person.salesCount === 0 ? 'table__row--muted' : undefined}>
                  <td>
                    <span className="table__primary-link">{person.name}</span>
                    <span className="table__secondary">
                      {person.hasLeft ? `${ROLE_LABEL[person.role]}, no longer on the team` : ROLE_LABEL[person.role]}
                    </span>
                  </td>
                  <td className="table__numeric">{person.salesCount}</td>
                  <td className="table__numeric">{person.unitsSold}</td>
                  <td className="table__numeric">{formatMoney(person.revenue)}</td>
                  <td className="table__numeric">{formatMoney(person.refunds)}</td>
                  <td className="table__numeric">{formatMoney(person.profit)}</td>
                  <td className="table__numeric">{person.salesCount === 0 ? '–' : formatMoney(person.averageSale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ProfitTable({ range }: { range: { startDate: string; endDate: string } }) {
  const [groupBy, setGroupBy] = useState<'product' | 'category'>('product');
  const profit = useQuery({
    queryKey: ['reports', 'profit', range, groupBy],
    queryFn: () => reportsApi.profit(range, groupBy),
    placeholderData: keepPreviousData,
  });

  return (
    <section className="panel" aria-labelledby="profit-heading">
      <div className="panel__header">
        <h2 id="profit-heading" className="panel__title">
          Profit by {groupBy}
        </h2>
        <div className="segmented" role="radiogroup" aria-label="Group profit by">
          {(['product', 'category'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={groupBy === option}
              className="segmented__option"
              onClick={() => setGroupBy(option)}
            >
              {option === 'product' ? 'Products' : 'Categories'}
            </button>
          ))}
        </div>
      </div>
      {profit.isPending && <Loading />}
      {profit.isError && <ErrorNotice error={profit.error} onRetry={() => profit.refetch()} />}
      {profit.data && profit.data.length === 0 && <EmptyState title="No sales in this period" />}
      {profit.data && profit.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{groupBy === 'product' ? 'Product' : 'Category'}</th>
                <th scope="col" className="table__numeric">Units</th>
                <th scope="col" className="table__numeric">Revenue</th>
                <th scope="col" className="table__numeric">Cost</th>
                <th scope="col" className="table__numeric">Profit</th>
                <th scope="col" className="table__numeric">Margin</th>
              </tr>
            </thead>
            <tbody>
              {profit.data.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    {row.hasUnknownCost && <span className="table__secondary">Some sales have no cost price</span>}
                  </td>
                  <td className="table__numeric">{row.unitsSold}</td>
                  <td className="table__numeric">{formatMoney(row.revenue)}</td>
                  <td className="table__numeric">{formatMoney(row.cost)}</td>
                  <td className="table__numeric">{formatMoney(row.profit)}</td>
                  <td className="table__numeric">{row.margin === null ? 'Unknown' : percent.format(row.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Exports({ range }: { range: { startDate: string; endDate: string } }) {
  const download = useMutation({
    mutationFn: (kind: 'sales' | 'stock' | 'team') => exportsApi.download(kind, kind === 'stock' ? undefined : range),
  });

  return (
    <section className="panel" aria-labelledby="exports-heading">
      <h2 id="exports-heading" className="panel__title">
        Download for Excel
      </h2>
      <div className="form-actions">
        <button type="button" className="button button--quiet" onClick={() => download.mutate('sales')} disabled={download.isPending}>
          Sales in this period
        </button>
        <button type="button" className="button button--quiet" onClick={() => download.mutate('team')} disabled={download.isPending}>
          Team report
        </button>
        <button type="button" className="button button--quiet" onClick={() => download.mutate('stock')} disabled={download.isPending}>
          Current stock
        </button>
      </div>
      {download.isError && (
        <p className="form-error" role="alert">
          {errorMessage(download.error)}
        </p>
      )}
    </section>
  );
}
