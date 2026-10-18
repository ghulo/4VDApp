import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CaretLeft, Coins, FileCsv, FileXls, type Icon, Package, Receipt, UsersThree, Wallet } from '@phosphor-icons/react';
import type { Catalogue } from '../i18n/en';
import { AnalyticsBoard } from '../components/AnalyticsBoard';
import { CounterReport } from '../components/CounterReport';
import { useSalesSeries } from '../components/useSalesSeries';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { PeriodPicker } from '../components/PeriodPicker';
import { RevenueChart } from '../components/RevenueChart';
import { CategoriesCard, PatternCards, TopProductsCard, usePatterns } from '../components/SalesPatterns';
import { analyticsApi, exportsApi, reportsApi } from '../services/api';
import { useT } from '../i18n/useT';
import { errorMessage } from '../utils/errors';
import { formatHeadlineMoney, formatMoney, formatPercent } from '../utils/format';
import { usePeriodParams } from '../utils/usePeriodParams';
import { BarList, Button, Card, DataTable, MetricCard, MetricGrid, PageHeader } from '../components/ui';
import type { TeamRow } from '../services/types';

/** Each tab of Reports is its own address; the period stays the same across them. */
export type ReportsView = 'figures' | 'team' | 'counter' | 'profit' | 'downloads';

export function ReportsPage({ view }: { view: ReportsView }) {
  const t = useT();
  const { period, from, to, range, rangeKey, comparedRange, changePeriod, compare, changeCompare } = usePeriodParams('this-month');

  if (view !== 'figures') {
    return (
      <>
        <PageHeader title={t.nav.items.reports} description={t.reports.description(range.label)} />
        <PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />
        {view === 'team' && <TeamView range={rangeKey} previous={previousOf(comparedRange)} />}
        {view === 'counter' && <CounterReport range={rangeKey} />}
        {view === 'profit' && <ProfitTable range={rangeKey} />}
        {view === 'downloads' && <Exports range={rangeKey} label={range.label} />}
      </>
    );
  }

  return (
    <>
      <PageHeader title={t.nav.items.reports} description={t.reports.description(range.label)} />

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
              to="/report"
            />
            <MetricCard label={t.reports.expenses} value={formatHeadlineMoney(expenses.current)} hint={t.reports.expensesHint} to="/expenses" />
            <MetricCard
              label={t.reports.netProfit}
              value={formatHeadlineMoney(netProfit.current)}
              change={netProfit.change}
              hint={t.reports.netProfitHint}
              to="/report"
            />
            <MetricCard
              label={t.analytics.margin}
              value={current.margin === null ? t.reports.unknown : formatPercent(current.margin)}
              to="/sales"
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
      <div className="analysis-grid">
        <PatternCards range={rangeKey} />
        <CategoriesCard range={rangeKey} />
        <TopProductsCard range={rangeKey} />
      </div>
      <Leaderboard range={rangeKey} />
    </>
  );
}

type Range = { startDate: string; endDate: string };

/** The period compared against: the one given, or the same length just before. */
function previousOf(range: Range & { previousStartDate?: string; previousEndDate?: string }): Range {
  if (range.previousStartDate && range.previousEndDate) return { startDate: range.previousStartDate, endDate: range.previousEndDate };
  const start = new Date(range.startDate).getTime();
  const length = new Date(range.endDate).getTime() - start;
  return { startDate: new Date(start - length).toISOString(), endDate: range.startDate };
}

function useTeam(range: Range) {
  return useQuery({ queryKey: ['reports', 'team', range], queryFn: () => reportsApi.team(range), placeholderData: keepPreviousData });
}

/** A link to one person's figures that keeps the picked period. */
function usePersonLink() {
  const [params] = useSearchParams();
  return (userId: number | null) => {
    const next = new URLSearchParams(params);
    if (userId === null) next.delete('person');
    else next.set('person', String(userId));
    return `/reports/team?${next}`;
  };
}

/** Revenue per person as ranked bars; each name opens that person's figures. */
function Leaderboard({ range, compact = true }: { range: Range; compact?: boolean }) {
  const t = useT();
  const team = useTeam(range);
  const personLink = usePersonLink();
  const sellers = (team.data ?? []).filter((person) => person.salesCount > 0 || person.revenue !== 0);
  return (
    <Card
      title={t.analysis.leaderboard}
      description={t.analysis.leaderboardHint}
      actions={
        compact && (
          <Link to={personLink(null)} className="text-link">
            {t.analysis.openTeam}
          </Link>
        )
      }
    >
      {team.isPending && <Loading />}
      {team.isError && <ErrorNotice error={team.error} onRetry={() => team.refetch()} />}
      {team.data &&
        (sellers.length === 0 ? (
          <EmptyState title={t.analysis.nothingYet} />
        ) : (
          <BarList
            label={t.analysis.leaderboard}
            items={sellers.map((person) => ({
              key: person.userId,
              label: person.name,
              to: personLink(person.userId),
              value: person.revenue,
              display: formatHeadlineMoney(person.revenue),
              detail: t.analysis.personDetail(person.salesCount, formatMoney(person.averageSale)),
            }))}
          />
        ))}
    </Card>
  );
}

function TeamView({ range, previous }: { range: Range; previous: Range }) {
  const [params] = useSearchParams();
  const person = Number(params.get('person')) || null;
  if (person !== null) return <PersonReport userId={person} range={range} previous={previous} />;
  return (
    <>
      <Leaderboard range={range} compact={false} />
      <TeamTable range={range} />
    </>
  );
}

const changeOf = (now: number, before: number | undefined) => (before === undefined || before === 0 ? null : now / before - 1);

/** One person's period: their figures against the period before, when they sell, and what. */
function PersonReport({ userId, range, previous }: { userId: number; range: Range; previous: Range }) {
  const t = useT();
  const personLink = usePersonLink();
  const team = useTeam(range);
  const before = useTeam(previous);
  const patterns = usePatterns(range, userId);
  const person = team.data?.find((row) => row.userId === userId);
  const earlier: TeamRow | undefined = before.data?.find((row) => row.userId === userId);

  return (
    <>
      <p className="person-report__back">
        <Link to={personLink(null)} className="text-link">
          <CaretLeft size={14} weight="bold" aria-hidden="true" /> {t.analysis.wholeTeam}
        </Link>
      </p>
      {team.isPending && <Loading />}
      {team.isError && <ErrorNotice error={team.error} onRetry={() => team.refetch()} />}
      {team.data && !person && <EmptyState title={t.analysis.notFound} />}
      {person && (
        <>
          <h2 className="person-report__name">
            {person.name}
            <span className="person-report__role">
              {person.hasLeft ? t.reports.hasLeft(t.common.roles[person.role]) : t.common.roles[person.role]}
            </span>
          </h2>
          <MetricGrid>
            <MetricCard
              large
              label={t.analysis.revenue}
              value={formatHeadlineMoney(person.revenue)}
              change={changeOf(person.revenue, earlier?.revenue)}
              series={patterns.data?.days.map((day) => day.revenue)}
            />
            <MetricCard
              large
              label={t.analysis.sales}
              value={person.salesCount}
              change={changeOf(person.salesCount, earlier?.salesCount)}
              series={patterns.data?.days.map((day) => day.salesCount)}
            />
            <MetricCard label={t.analysis.averageSale} value={formatHeadlineMoney(person.averageSale)} change={changeOf(person.averageSale, earlier?.averageSale)} />
            <MetricCard label={t.analysis.profit} value={formatHeadlineMoney(person.profit)} change={changeOf(person.profit, earlier?.profit)} />
            <MetricCard
              label={t.analysis.commission}
              value={person.commission === null ? '–' : formatMoney(person.commission)}
              hint={person.commissionPercent === null ? undefined : t.reports.ofRevenue(person.commissionPercent)}
            />
            <MetricCard
              label={t.analysis.target}
              value={person.monthlyTarget === null ? '–' : formatPercent(person.revenue / person.monthlyTarget)}
              hint={
                person.monthlyTarget === null ? (
                  t.analysis.noTarget
                ) : (
                  <TargetBar
                    share={person.revenue / person.monthlyTarget}
                    label={t.analysis.targetProgress(formatPercent(person.revenue / person.monthlyTarget), formatMoney(person.monthlyTarget))}
                  />
                )
              }
            />
          </MetricGrid>
          <Card>
            {patterns.isPending && <Loading />}
            {patterns.isError && <ErrorNotice error={patterns.error} onRetry={() => patterns.refetch()} />}
            {patterns.data && <RevenueChart points={patterns.data.days} title={t.analysis.theirDays} />}
          </Card>
          <div className="analysis-grid">
            <PatternCards range={range} userId={userId} />
            <TopProductsCard range={range} userId={userId} title={t.analysis.theirProducts} />
            <CategoriesCard range={range} userId={userId} title={t.analysis.theirCategories} />
          </div>
        </>
      )}
    </>
  );
}

/** How far into the monthly target, as a slim bar with the words beside it. */
function TargetBar({ share, label }: { share: number; label: string }) {
  return (
    <span className="target-bar">
      <span className="target-bar__track" aria-hidden="true">
        <span className="target-bar__fill" style={{ inlineSize: `${Math.min(Math.max(share, 0), 1) * 100}%` }} />
      </span>
      {label}
    </span>
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
  const personLink = usePersonLink();
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
                  <Link to={personLink(person.userId)} className="table__primary-link" aria-label={t.analysis.open(person.name)}>
                    {person.name}
                  </Link>
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

type ExportKind = 'money' | 'expenses' | 'sales' | 'team' | 'stock';

const EXPORTS: Array<{ kind: ExportKind; icon: Icon; title: (t: Catalogue) => string }> = [
  { kind: 'money', icon: Coins, title: (t) => t.reports.moneyPerDay },
  { kind: 'expenses', icon: Wallet, title: (t) => t.reports.expensesList },
  { kind: 'sales', icon: Receipt, title: (t) => t.reports.salesInPeriod },
  { kind: 'team', icon: UsersThree, title: (t) => t.reports.teamReport },
  { kind: 'stock', icon: Package, title: (t) => t.reports.currentStock },
];

/** Each download as a card: what's in it, for when, and the two formats. */
function Exports({ range, label }: { range: { startDate: string; endDate: string }; label: string }) {
  const t = useT();
  const download = useMutation({
    mutationFn: ({ kind, format }: { kind: ExportKind; format: 'xlsx' | 'csv' }) =>
      exportsApi.download(kind, format, kind === 'stock' ? undefined : range),
  });
  const busy = (kind: ExportKind, format: 'xlsx' | 'csv') =>
    download.isPending && download.variables.kind === kind && download.variables.format === format;

  return (
    <Card title={t.reports.download} description={t.reports.forAccountantHint}>
      <ul className="download-grid">
        {EXPORTS.map(({ kind, icon: IconComponent, title }) => (
          <li key={kind} className="download-card">
            <span className="download-card__icon" aria-hidden="true">
              <IconComponent size={20} />
            </span>
            <span className="download-card__text">
              <span className="download-card__title">{title(t)}</span>
              <span className="download-card__what">{t.reports.downloads[kind]}</span>
              <span className="download-card__when">{kind === 'stock' ? t.reports.downloads.rightNow : t.reports.downloads.forPeriod(label)}</span>
            </span>
            <span className="download-card__actions">
              <Button
                variant="primary"
                size="sm"
                icon={FileXls}
                disabled={download.isPending}
                aria-label={t.reports.downloads.excelLabel(title(t))}
                aria-busy={busy(kind, 'xlsx')}
                onClick={() => download.mutate({ kind, format: 'xlsx' })}
              >
                {t.reports.downloads.excel}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={FileCsv}
                disabled={download.isPending}
                aria-label={t.reports.downloads.csvLabel(title(t))}
                aria-busy={busy(kind, 'csv')}
                onClick={() => download.mutate({ kind, format: 'csv' })}
              >
                {t.reports.downloads.csv}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <p className="field-hint">{t.reports.downloads.formatsHint}</p>
      {download.isError && (
        <p className="form-error" role="alert">
          {errorMessage(download.error)}
        </p>
      )}
    </Card>
  );
}
