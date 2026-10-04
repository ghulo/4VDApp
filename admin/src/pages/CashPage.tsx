import { Coins } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ErrorNotice, Loading } from '../components/Feedback';
import { PeriodPicker } from '../components/PeriodPicker';
import { useT } from '../i18n/useT';
import { cashApi } from '../services/api';
import type { CashCount, CashPlace } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateWith, formatMoney } from '../utils/format';
import { usePeriodParams } from '../utils/usePeriodParams';
import { Badge, Button, Card, DataTable, EmptyState, Field, PageHeader, StatGrid, StatTile } from '../components/ui';

const PLACES: CashPlace[] = ['shop', 'carwash'];
/** Same as the server: a few coins either way still matches. */
const TOLERANCE = 0.5;

/** "Sat 4 Oct" for a "2026-10-04" day, without any time zone moving it. */
const formatDay = (day: string) =>
  formatDateWith(new Date(`${day}T00:00:00Z`), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

/** How each drawer's count compared with what was sold, and a way to count one from here. */
export function CashPage() {
  const t = useT();
  const { period, from, to, range, rangeKey, changePeriod } = usePeriodParams('this-month');
  const counts = useQuery({
    queryKey: ['cash', rangeKey],
    queryFn: () => cashApi.list(rangeKey),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title={t.cash.title}
        description={t.cash.description(range.label)}
        actions={<PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />}
      />

      {counts.data && <Totals counts={counts.data} />}

      {/* Everyone on the dashboard may count a drawer (the owner too). */}
      <Card title={t.cash.countTitle}>
        <CountForm />
      </Card>

      {counts.isPending && <Loading />}
      {counts.isError && <ErrorNotice error={counts.error} onRetry={() => counts.refetch()} />}
      {counts.data && (
        <Card title={t.cash.countsInPeriod} flush>
          <DataTable
            caption={t.cash.caption}
            rows={counts.data}
            rowKey={(row) => row.id}
            empty={<EmptyState icon={Coins} title={t.cash.none}>{t.cash.noneHint}</EmptyState>}
            columns={[
              { header: t.cash.day, cell: (row) => formatDay(row.day), title: true },
              { header: t.cash.drawer, cell: (row) => t.cash.places[row.place] },
              { header: t.cash.counted, cell: (row) => formatMoney(row.counted), align: 'end' },
              { header: t.cash.float, cell: (row) => formatMoney(row.float), align: 'end' },
              { header: t.cash.expected, cell: (row) => (row.expected === null ? '–' : formatMoney(row.expected)), align: 'end' },
              { header: t.cash.difference, cell: (row) => <DifferenceBadge difference={row.difference} /> },
              {
                header: t.cash.countedBy,
                cell: (row) => (
                  <>
                    {row.countedBy ?? '–'}
                    {row.note && <span className="table__secondary">{row.note}</span>}
                  </>
                ),
              },
            ]}
          />
        </Card>
      )}
    </>
  );
}

function Totals({ counts }: { counts: CashCount[] }) {
  const t = useT();
  const compared = counts.filter((count) => count.difference !== null);
  const off = compared.filter((count) => Math.abs(count.difference!) >= TOLERANCE);
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
        value={Math.abs(net) < TOLERANCE ? t.cash.matches : net < 0 ? t.cash.short(formatMoney(-net)) : t.cash.over(formatMoney(net))}
      />
    </StatGrid>
  );
}

function DifferenceBadge({ difference }: { difference: number | null }) {
  const t = useT();
  if (difference === null) return <Badge tone="neutral">{t.cash.nothingToCompare}</Badge>;
  if (Math.abs(difference) < TOLERANCE) return <Badge tone="ok">{t.cash.matches}</Badge>;
  return difference < 0 ? (
    <Badge tone="danger">{t.cash.short(formatMoney(-difference))}</Badge>
  ) : (
    <Badge tone="warn">{t.cash.over(formatMoney(difference))}</Badge>
  );
}

function CountForm() {
  const t = useT();
  const queryClient = useQueryClient();
  const today = useQuery({ queryKey: ['cash', 'today'], queryFn: cashApi.today });
  const [place, setPlace] = useState<CashPlace>('shop');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: () => cashApi.count({ place, counted: Number(counted), note: note.trim() || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setCounted('');
      setNote('');
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  const status = today.data?.find((entry) => entry.place === place);
  const isValid = counted.trim() !== '' && Number(counted) >= 0;

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="segmented" role="radiogroup" aria-label={t.cash.drawer}>
        {PLACES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={place === option}
            className="segmented__option"
            onClick={() => {
              setPlace(option);
              save.reset();
            }}
          >
            {t.cash.places[option]}
          </button>
        ))}
      </div>
      <Field
        label={t.cash.counted}
        hint={status ? t.cash.countedHint(formatMoney(status.float)) : undefined}
        narrow
      >
        <input
          type="number"
          inputMode="decimal"
          required
          min={0}
          step={0.01}
          value={counted}
          onChange={(event) => setCounted(event.target.value)}
        />
      </Field>
      <Field label={t.cash.note}>
        <input maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {status?.countedAt && !save.data && <p className="field-hint">{t.cash.recount}</p>}
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      {save.data && (
        <p className="form-success" role="status">
          {t.cash.places[save.data.place]}: <DifferenceBadge difference={save.data.difference} />
        </p>
      )}
      <Button type="submit" variant="primary" disabled={!isValid || save.isPending}>
        {save.isPending ? t.cash.saving : t.cash.save}
      </Button>
    </form>
  );
}
