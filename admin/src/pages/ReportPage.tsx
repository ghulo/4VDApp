import { CaretLeft, CaretRight, PaperPlaneTilt } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, Button, ButtonLink, Card, DataTable, DayBars, EmptyState, MetricCard, MetricGrid, PageHeader, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';
import { fullReportsApi } from '../services/api';
import type { FullReport, ReportKind } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate, formatHeadlineMoney, formatMoney, formatPercent } from '../utils/format';

const DAY_MS = 24 * 60 * 60 * 1000;
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The full daily or weekly report, the same one the alert links to. */
export function ReportPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const kind: ReportKind = params.get('kind') === 'weekly' ? 'weekly' : 'daily';
  const from = params.get('from') ?? undefined;
  const report = useQuery({
    queryKey: ['full-report', kind, from ?? 'latest'],
    queryFn: () => fullReportsApi.get(kind, from),
    placeholderData: keepPreviousData,
  });
  const sendTest = useMutation({ mutationFn: () => fullReportsApi.sendTest(kind) });
  const step = kind === 'daily' ? 1 : 7;
  const go = (next: Record<string, string>) => setParams({ kind, ...(from ? { from } : {}), ...next });

  return (
    <>
      <PageHeader
        title={t.fullReport.title[kind]}
        description={report.data ? period(report.data, t.fullReport.through) : t.fullReport.description}
        meta={report.data?.partial ? <Badge tone="info">{t.fullReport.soFar}</Badge> : undefined}
        actions={
          <>
            <Button icon={PaperPlaneTilt} disabled={sendTest.isPending} onClick={() => sendTest.mutate()}>
              {sendTest.isPending ? t.fullReport.sending : t.fullReport.sendMe}
            </Button>
            <ButtonLink to="/profile" variant="ghost">
              {t.fullReport.choose}
            </ButtonLink>
          </>
        }
      />
      {(sendTest.isSuccess || sendTest.isError) && (
        <p className={sendTest.isError ? 'form-error' : 'form-success'} role={sendTest.isError ? 'alert' : 'status'}>
          {sendTest.isError ? errorMessage(sendTest.error) : t.fullReport.sent}
        </p>
      )}

      <div className="toolbar report-toolbar">
        <div className="segmented" role="radiogroup" aria-label={t.fullReport.kind}>
          {(['daily', 'weekly'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              className="segmented__option"
              onClick={() => setParams({ kind: option })}
            >
              {t.fullReport.kinds[option]}
            </button>
          ))}
        </div>
        {report.data && (
          <span className="report-toolbar__dates">
            <Button variant="ghost" size="sm" icon={CaretLeft} aria-label={t.fullReport.earlier} onClick={() => go({ from: shift(report.data.from, -step) })} />
            <label className="inline-field">
              <span className="visually-hidden">{t.fullReport.startsOn}</span>
              <input type="date" value={report.data.from} onChange={(event) => event.target.value && go({ from: event.target.value })} />
            </label>
            <Button
              variant="ghost"
              size="sm"
              icon={CaretRight}
              aria-label={t.fullReport.later}
              disabled={report.data.partial}
              onClick={() => go({ from: shift(report.data.from, step) })}
            />
          </span>
        )}
      </div>

      {report.isPending && <Loading />}
      {report.isError && <ErrorNotice error={report.error} onRetry={() => report.refetch()} />}
      {report.data && <ReportSections report={report.data} />}
    </>
  );
}

function period(report: FullReport, through: (from: string, to: string) => string) {
  return report.kind === 'daily' ? formatDate(report.from) : through(formatDate(report.from), formatDate(report.to));
}

function ReportSections({ report }: { report: FullReport }) {
  const t = useT();
  const s = report.sections;
  const none = (text: string) => <p className="field-hint">{text}</p>;
  const card = (key: keyof typeof t.report.sections, children: ReactNode, actions?: ReactNode) => (
    <Card title={t.report.sections[key]} actions={actions}>
      {children}
    </Card>
  );

  return (
    <div className="report">
      {s.sales && (
        <section aria-label={t.report.sections.sales}>
          <MetricGrid>
            <MetricCard label={t.fullReport.revenue} value={formatHeadlineMoney(s.sales.revenue)} change={s.sales.change} hint={t.fullReport.before(formatMoney(s.sales.previousRevenue))} />
            <MetricCard label={t.fullReport.profit} value={formatHeadlineMoney(s.sales.profit)} hint={s.sales.margin === null ? undefined : t.fullReport.margin(formatPercent(s.sales.margin))} />
            <MetricCard label={t.fullReport.net} value={formatHeadlineMoney(s.sales.netProfit)} hint={t.fullReport.netHint} />
            <MetricCard label={t.fullReport.salesCount} value={s.sales.salesCount} hint={t.fullReport.units(s.sales.unitsSold, formatMoney(s.sales.averageSale))} />
          </MetricGrid>
          {s.sales.byDay.length > 0 && (
            <Card title={t.fullReport.byDay}>
              <DayBars values={s.sales.byDay.map((day) => day.revenue)} label={t.fullReport.byDay} />
              <ul className="report-days">
                {s.sales.byDay.map((day) => (
                  <li key={day.day}>
                    <span>{formatDate(day.day)}</span>
                    <span>{formatMoney(day.revenue)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}

      <div className="report-grid">
        {s.products &&
          card(
            'products',
            s.products.length === 0 ? (
              none(t.fullReport.noSales)
            ) : (
              <DataTable
                caption={t.report.sections.products}
                rows={s.products}
                rowKey={(row) => row.name}
                columns={[
                  { header: t.fullReport.product, title: true, cell: (row) => row.name },
                  { header: t.fullReport.sold, align: 'end', cell: (row) => row.unitsSold },
                  { header: t.fullReport.revenue, align: 'end', cell: (row) => formatMoney(row.revenue) },
                  { header: t.fullReport.profit, align: 'end', cell: (row) => formatMoney(row.profit) },
                ]}
              />
            ),
          )}
        {s.team &&
          card(
            'team',
            s.team.length === 0 ? (
              none(t.fullReport.noSales)
            ) : (
              <DataTable
                caption={t.report.sections.team}
                rows={s.team}
                rowKey={(row) => row.name}
                columns={[
                  { header: t.fullReport.person, title: true, cell: (row) => row.name },
                  { header: t.fullReport.salesCount, align: 'end', cell: (row) => row.salesCount },
                  { header: t.fullReport.revenue, align: 'end', cell: (row) => formatMoney(row.revenue) },
                ]}
              />
            ),
          )}
        {s.bills &&
          card(
            'bills',
            <>
              <StatGrid>
                <StatTile label={t.fullReport.owed} value={formatMoney(s.bills.owed)} to="/bills" />
                <StatTile label={t.fullReport.overdue} value={formatMoney(s.bills.overdue.amount)} hint={t.fullReport.billCount(s.bills.overdue.count)} tone={s.bills.overdue.count > 0 ? 'danger' : 'default'} to="/bills" />
                <StatTile label={t.fullReport.dueSoon} value={formatMoney(s.bills.dueSoon.amount)} hint={t.fullReport.billCount(s.bills.dueSoon.count)} to="/bills" />
                <StatTile label={t.fullReport.paidInPeriod} value={formatMoney(s.bills.paid.total)} hint={t.fullReport.payments(s.bills.paid.count)} />
              </StatGrid>
              {s.bills.next.length > 0 && (
                <ul className="report-list">
                  {s.bills.next.map((bill, index) => (
                    <li key={index}>
                      <span>
                        {bill.supplier}
                        {bill.number && <span className="table__secondary"> {t.fullReport.billNo(bill.number)}</span>}
                      </span>
                      <span>
                        {formatMoney(bill.left)} {bill.dueOn && <Badge tone={bill.overdue ? 'danger' : 'neutral'}>{bill.overdue ? `${t.fullReport.overdue} · ${formatDate(bill.dueOn)}` : formatDate(bill.dueOn)}</Badge>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>,
            <Link to="/bills">{t.fullReport.openBills}</Link>,
          )}
        {s.stock &&
          card(
            'stock',
            s.stock.soldOut.length + s.stock.runningOut.length + s.stock.expiring.length === 0 ? (
              none(t.fullReport.stockFine)
            ) : (
              <dl className="report-stock">
                {(['soldOut', 'runningOut', 'expiring'] as const)
                  .filter((key) => s.stock![key].length > 0)
                  .map((key) => (
                    <div key={key}>
                      <dt>{t.fullReport.stock[key]}</dt>
                      {s.stock![key].map((title) => (
                        <dd key={title}>{title}</dd>
                      ))}
                    </div>
                  ))}
              </dl>
            ),
            <Link to="/inventory">{t.fullReport.openStock}</Link>,
          )}
        {s.losses &&
          card(
            'losses',
            <StatGrid>
              <StatTile label={t.fullReport.refunds} value={formatMoney(s.losses.refunds)} />
              <StatTile label={t.fullReport.stockLosses} value={formatMoney(s.losses.stockLosses)} />
            </StatGrid>,
          )}
        {s.carwash &&
          card(
            'carwash',
            s.carwash.each.length === 0 ? (
              none(t.fullReport.noCarwash)
            ) : (
              <ul className="report-list">
                {s.carwash.each.map((row) => (
                  <li key={row.name}>
                    <span>
                      {row.name}
                      <span className="table__secondary"> {t.fullReport.carwashSplit(formatMoney(row.carwash), formatMoney(row.change))}</span>
                    </span>
                    <span>{formatMoney(row.total)}</span>
                  </li>
                ))}
              </ul>
            ),
          )}
        {s.cash &&
          card(
            'cash',
            s.cash.length === 0 ? (
              none(t.fullReport.noCash)
            ) : (
              <ul className="report-list">
                {s.cash.map((row, index) => (
                  <li key={index}>
                    <span>
                      {row.place}
                      {report.kind === 'weekly' && <span className="table__secondary"> {formatDate(row.day)}</span>}
                      <span className="table__secondary"> {t.fullReport.float(formatMoney(row.float))}</span>
                    </span>
                    <span>
                      {row.difference === null ? (
                        formatMoney(row.counted)
                      ) : row.difference === 0 ? (
                        <Badge tone="ok">{t.fullReport.matched}</Badge>
                      ) : (
                        <Badge tone={row.difference < 0 ? 'danger' : 'warn'}>
                          {row.difference < 0 ? t.fullReport.short(formatMoney(-row.difference)) : t.fullReport.over(formatMoney(row.difference))}
                        </Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ),
            <Link to="/cash">{t.fullReport.openCash}</Link>,
          )}
        {s.expenses &&
          card(
            'expenses',
            s.expenses.total === 0 ? (
              none(t.fullReport.noExpenses)
            ) : (
              <ul className="report-list">
                {s.expenses.byCategory.map((row) => (
                  <li key={row.category}>
                    <span>{t.expenses.categories[row.category as keyof typeof t.expenses.categories] ?? row.category}</span>
                    <span>{formatMoney(row.amount)}</span>
                  </li>
                ))}
                <li className="report-list__total">
                  <span>{t.fullReport.total}</span>
                  <span>{formatMoney(s.expenses.total)}</span>
                </li>
              </ul>
            ),
          )}
        {s.tabs &&
          card(
            'tabs',
            s.tabs.owed === 0 ? (
              none(t.fullReport.noTabs)
            ) : (
              <>
                <p>{t.fullReport.tabsOwed(formatMoney(s.tabs.owed), s.tabs.customers)}</p>
                {s.tabs.overdue.length > 0 && (
                  <ul className="report-list">
                    {s.tabs.overdue.map((row) => (
                      <li key={row.name}>
                        <span>{row.name}</span>
                        <Badge tone="warn">{formatMoney(row.balance)}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ),
            <Link to="/customers">{t.fullReport.openTabs}</Link>,
          )}
        {s.approvals &&
          card(
            'approvals',
            s.approvals.total === 0 ? none(t.fullReport.noApprovals) : <p>{t.fullReport.waiting(s.approvals.total)}</p>,
            s.approvals.total > 0 ? <Link to="/inbox">{t.fullReport.openApprovals}</Link> : undefined,
          )}
      </div>
      {Object.keys(s).length === 0 && <EmptyState title={t.fullReport.nothingChosen} />}
    </div>
  );
}
