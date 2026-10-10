import { Coins } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CASH_TOLERANCE, CashCountsTable, CountForm } from '../components/CashCount';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PeriodPicker } from '../components/PeriodPicker';
import { useT } from '../i18n/useT';
import { cashApi } from '../services/api';
import type { CashCount } from '../services/types';
import { formatMoney } from '../utils/format';
import { usePeriodParams } from '../utils/usePeriodParams';
import { Button, Card, EmptyState, PageHeader, Sheet, StatGrid, StatTile, useNewSheet } from '../components/ui';

const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

/** Every drawer count over a period, how each compared with what was sold, and a way to count one from here. */
export function CashPage() {
  const t = useT();
  const { period, from, to, range, rangeKey, changePeriod } = usePeriodParams('this-month');
  const counts = useQuery({
    queryKey: ['cash', rangeKey],
    queryFn: () => cashApi.list(rangeKey),
    placeholderData: keepPreviousData,
  });

  const [counting, setCounting] = useNewSheet();

  return (
    <>
      <Sheet open={counting} onClose={() => setCounting(false)} title={t.cash.countTitle}>
        <CountForm />
      </Sheet>
      <PageHeader
        title={t.nav.items.day}
        description={t.cash.description(range.label)}
        actions={
          <>
            <PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />
            {/* Everyone on the dashboard may count a drawer (the owner too). */}
            <Button variant="primary" icon={Coins} onClick={() => setCounting(true)}>
              {t.cash.countTitle}
            </Button>
          </>
        }
      />

      {counts.data && <Totals counts={counts.data} />}

      {counts.isPending && <Loading />}
      {counts.isError && <ErrorNotice error={counts.error} onRetry={() => counts.refetch()} />}
      {counts.data && (
        <Card title={t.cash.countsInPeriod} flush>
          <CashCountsTable counts={counts.data} empty={<EmptyState icon={Coins} title={t.cash.none}>{t.cash.noneHint}</EmptyState>} />
        </Card>
      )}
    </>
  );
}

function Totals({ counts }: { counts: CashCount[] }) {
  const t = useT();
  const compared = counts.filter((count) => count.difference !== null);
  const off = compared.filter((count) => Math.abs(count.difference!) >= CASH_TOLERANCE);
  const net = roundMoney(compared.reduce((sum, count) => sum + count.difference!, 0));
  return (
    <StatGrid>
      <StatTile label={t.cash.countsInPeriod} value={counts.length} />
      <StatTile
        label={t.cash.difference}
        value={off.length === 0 ? t.cash.allMatched : t.cash.differences(off.length)}
        tone={off.length === 0 ? 'default' : 'warn'}
      />
      <StatTile
        label={t.cash.netDifference}
        value={Math.abs(net) < CASH_TOLERANCE ? t.cash.matches : net < 0 ? t.cash.short(formatMoney(-net)) : t.cash.over(formatMoney(net))}
      />
    </StatGrid>
  );
}

