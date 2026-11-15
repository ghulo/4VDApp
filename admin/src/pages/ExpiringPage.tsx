import { Check, Trash } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Badge, Button, DataTable, EmptyState, PageHeader, Section, StatGrid, StatTile, useToast } from '../components/ui';
import { useT } from '../i18n/useT';
import { expiryApi } from '../services/api';
import type { ExpiryDate } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateWith, formatHeadlineMoney, formatMoney } from '../utils/format';

/** How far ahead the list looks. */
const AHEAD_DAYS = 14;

/** "Sat 4 Oct" for a "2026-10-04" day, without any time zone moving it. */
const formatDay = (day: string) => formatDateWith(new Date(`${day}T00:00:00Z`), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const sumValue = (rows: ExpiryDate[]) => rows.reduce((total, row) => total + (row.valueAtCost ?? 0), 0);

/**
 * Stock → Expiring: what passes its best-before date in the next two weeks
 * (or already has), soonest first, with what it is worth at cost, today's
 * short-dated price, and a write-off once the date has passed.
 */
export function ExpiringPage() {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const dates = useQuery({ queryKey: ['expiry', 'upcoming', AHEAD_DAYS], queryFn: () => expiryApi.upcoming(AHEAD_DAYS) });
  const refresh = () => {
    for (const key of ['expiry', 'inventory', 'products', 'notifications', 'insights', 'write-offs']) void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const writeOff = useMutation({
    mutationFn: (row: ExpiryDate) => expiryApi.writeOff(row.id),
    onSuccess: (result, row) => {
      toast({ title: t.expiring.writtenOff(result.quantity, row.productName) });
      refresh();
    },
    onError: (error) => toast({ title: errorMessage(error), tone: 'danger' }),
  });
  const dealtWith = useMutation({
    mutationFn: (row: ExpiryDate) => expiryApi.clear(row.id),
    onSuccess: () => refresh(),
    onError: (error) => toast({ title: errorMessage(error), tone: 'danger' }),
  });

  const rows = dates.data ?? [];
  const expired = rows.filter((row) => row.daysLeft < 0);
  const shortDated = rows.filter((row) => row.shortDated);
  const busy = (row: ExpiryDate) => (writeOff.isPending && writeOff.variables?.id === row.id) || (dealtWith.isPending && dealtWith.variables?.id === row.id);

  return (
    <>
      <PageHeader title={t.expiring.title} description={t.expiring.description(AHEAD_DAYS)} />
      {dates.data && (
        <StatGrid compact>
          <StatTile label={t.expiring.soonValue} value={formatHeadlineMoney(sumValue(rows))} />
          <StatTile label={t.expiring.expiredValue} value={formatHeadlineMoney(sumValue(expired))} tone={expired.length > 0 ? 'danger' : 'default'} />
          <StatTile label={t.expiring.shortDatedNow} value={String(shortDated.length)} />
        </StatGrid>
      )}
      {dates.isPending && <Loading />}
      {dates.isError && <ErrorNotice error={dates.error} onRetry={() => dates.refetch()} />}
      {dates.data && (
        <Section title={t.expiring.list}>
          <DataTable
            caption={t.expiring.caption}
            rows={rows}
            rowKey={(row) => row.id}
            empty={<EmptyState title={t.expiring.none}>{t.expiring.noneHint}</EmptyState>}
            columns={[
              {
                header: t.expiring.product,
                title: true,
                cell: (row) => (
                  <>
                    <Link to={`/products/${row.productId}`}>{row.productName}</Link>
                    {row.note && <span className="table__secondary">{row.note}</span>}
                  </>
                ),
              },
              {
                header: t.expiring.bestBefore,
                cell: (row) => (
                  <>
                    {formatDay(row.expiresOn)}
                    <span className="table__secondary">
                      <Badge tone={row.daysLeft < 0 ? 'danger' : row.daysLeft <= 2 ? 'warn' : 'neutral'}>{t.counter.expires(row.daysLeft)}</Badge>
                    </span>
                  </>
                ),
              },
              { header: t.expiring.left, cell: (row) => row.remaining, align: 'end' },
              { header: t.expiring.value, cell: (row) => (row.valueAtCost === null ? '–' : formatMoney(row.valueAtCost)), align: 'end', className: 'table__phone-hide' },
              {
                header: t.expiring.todayPrice,
                align: 'end',
                cell: (row) =>
                  row.shortDated ? (
                    <>
                      {formatMoney(row.shortDated.price)}
                      <span className="table__secondary">{t.expiring.off(`${row.shortDated.percentOff}%`, formatMoney(row.price))}</span>
                    </>
                  ) : (
                    formatMoney(row.price)
                  ),
              },
              {
                header: t.expiring.actions,
                cell: (row) => (
                  <span className="toolbar">
                    {row.daysLeft < 0 && (
                      <Button size="sm" variant="secondary" icon={Trash} disabled={busy(row)} onClick={() => writeOff.mutate(row)}>
                        {t.expiring.writeOff}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" icon={Check} disabled={busy(row)} onClick={() => dealtWith.mutate(row)}>
                      {t.expiring.dealtWith}
                    </Button>
                  </span>
                ),
              },
            ]}
          />
        </Section>
      )}
    </>
  );
}
