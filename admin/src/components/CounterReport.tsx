import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useT } from '../i18n/useT';
import { counterApi } from '../services/api';
import { formatDateTime, formatMoney } from '../utils/format';
import { periodDays } from '../utils/periods';
import { EmptyState, ErrorNotice, Loading } from './Feedback';
import { DataTable, Section } from './ui';

/**
 * Reports, Counter: what each person did at the till (how their sales were
 * paid, lines taken off, baskets cancelled, refunds, drawer opens and
 * receipts that didn't print), then every one of those moments with its reason.
 */
export function CounterReport({ range }: { range: { startDate: string; endDate: string } }) {
  const t = useT();
  const days = useMemo(() => periodDays(range), [range]);
  const people = useQuery({ queryKey: ['counter', 'people', days], queryFn: () => counterApi.people(days), placeholderData: keepPreviousData });
  const events = useQuery({ queryKey: ['counter', 'events', days], queryFn: () => counterApi.events(days), placeholderData: keepPreviousData });
  const sum = (pick: (row: NonNullable<typeof people.data>[number]) => number) => (people.data ?? []).reduce((total, row) => total + pick(row), 0);

  return (
    <>
      <Section title={t.counterReport.people}>
        {people.isPending ? (
          <Loading />
        ) : people.isError ? (
          <ErrorNotice error={people.error} onRetry={() => people.refetch()} />
        ) : (
          <DataTable
            caption={t.counterReport.people}
            rows={people.data ?? []}
            rowKey={(row) => row.user.id}
            empty={<EmptyState title={t.counterReport.emptyPeople}>{t.counterReport.emptyPeopleHint}</EmptyState>}
            columns={[
              {
                header: t.counterReport.person,
                title: true,
                cell: (row) => (
                  <Link to={`/people/${row.user.id}`} className="table__primary-link">
                    {row.user.name}
                  </Link>
                ),
              },
              { header: t.counterReport.sales, align: 'end', cell: (row) => row.sales },
              { header: t.counterReport.cash, align: 'end', cell: (row) => formatMoney(row.cash) },
              { header: t.counterReport.card, align: 'end', cell: (row) => formatMoney(row.card) },
              { header: t.counterReport.tab, align: 'end', cell: (row) => formatMoney(row.tab) },
              { header: t.counterReport.removed, align: 'end', cell: (row) => t.counterReport.countAndAmount(row.linesRemoved, formatMoney(row.removedAmount)) },
              { header: t.counterReport.cancelled, align: 'end', cell: (row) => t.counterReport.countAndAmount(row.basketsCancelled, formatMoney(row.cancelledAmount)) },
              { header: t.counterReport.refunds, align: 'end', cell: (row) => t.counterReport.countAndAmount(row.refunds, formatMoney(row.refunded)) },
              { header: t.counterReport.drawer, align: 'end', cell: (row) => row.drawerOpens },
              { header: t.counterReport.printing, align: 'end', cell: (row) => row.printFailures },
            ]}
            totals={
              (people.data?.length ?? 0) > 1
                ? [
                    t.common.total,
                    sum((row) => row.sales),
                    formatMoney(sum((row) => row.cash)),
                    formatMoney(sum((row) => row.card)),
                    formatMoney(sum((row) => row.tab)),
                    t.counterReport.countAndAmount(sum((row) => row.linesRemoved), formatMoney(sum((row) => row.removedAmount))),
                    t.counterReport.countAndAmount(sum((row) => row.basketsCancelled), formatMoney(sum((row) => row.cancelledAmount))),
                    t.counterReport.countAndAmount(sum((row) => row.refunds), formatMoney(sum((row) => row.refunded))),
                    sum((row) => row.drawerOpens),
                    sum((row) => row.printFailures),
                  ]
                : undefined
            }
          />
        )}
      </Section>
      <Section title={t.counterReport.events}>
        {events.isPending ? (
          <Loading />
        ) : events.isError ? (
          <ErrorNotice error={events.error} onRetry={() => events.refetch()} />
        ) : (
          <DataTable
            caption={t.counterReport.events}
            rows={events.data ?? []}
            rowKey={(row) => row.id}
            empty={<EmptyState title={t.counterReport.emptyEvents}>{t.counterReport.emptyEventsHint}</EmptyState>}
            columns={[
              { header: t.counterReport.when, cell: (row) => formatDateTime(row.at) },
              { header: t.counterReport.what, title: true, cell: (row) => t.counterReport.kinds[row.kind] },
              { header: t.counterReport.who, cell: (row) => row.user?.name ?? '—' },
              {
                header: t.counterReport.detail,
                cell: (row) => (
                  <>
                    {row.product && <span>{row.quantity !== null ? `${row.quantity} × ${row.product.name}` : row.product.name}</span>}
                    {row.document && (
                      <Link to={`/documents/${row.document.id}`} className="table__primary-link">
                        {row.document.number}
                      </Link>
                    )}
                    {row.reason && <span className="table__secondary">{row.reason}</span>}
                  </>
                ),
              },
              { header: t.counterReport.amount, align: 'end', cell: (row) => (row.amount === null ? '—' : formatMoney(row.amount)) },
            ]}
          />
        )}
      </Section>
    </>
  );
}
