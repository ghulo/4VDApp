import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { cashApi } from '../services/api';
import type { CashCount } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateWith, formatMoney } from '../utils/format';
import { carwashLabel, useCarwashes } from '../utils/useCarwashes';
import { Badge, Button, DataTable, Field } from './ui';
import type { ReactNode } from 'react';

/** Same as the server: a few coins either way still matches. */
export const CASH_TOLERANCE = 0.5;

/** "Sat 4 Oct" for a "2026-10-04" day, without any time zone moving it. */
export const formatDay = (day: string) =>
  formatDateWith(new Date(`${day}T00:00:00Z`), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Each count with how it compared; `showDay` adds the date column (off on the Day page, where it is one date). */
export function CashCountsTable({ counts, showDay = true, empty }: { counts: CashCount[]; showDay?: boolean; empty: ReactNode }) {
  const t = useT();
  const { several } = useCarwashes();
  return (
    <DataTable
      caption={t.cash.caption}
      rows={counts}
      rowKey={(row) => row.id}
      empty={empty}
      columns={[
        ...(showDay ? [{ header: t.cash.day, cell: (row: CashCount) => formatDay(row.day), title: true }] : []),
        {
          header: t.cash.drawer,
          cell: (row: CashCount) => (row.place === 'shop' ? t.cash.places.shop : carwashLabel(t.cash.places.carwash, row.carwashName, several)),
          title: !showDay,
        },
        { header: t.cash.counted, cell: (row: CashCount) => formatMoney(row.counted), align: 'end' as const },
        { header: t.cash.float, cell: (row: CashCount) => formatMoney(row.float), align: 'end' as const },
        { header: t.cash.expected, cell: (row: CashCount) => (row.expected === null ? '–' : formatMoney(row.expected)), align: 'end' as const },
        {
          header: t.cash.difference,
          cell: (row: CashCount) => (
            <>
              <DifferenceBadge difference={row.difference} />
              {row.checkedBy && <span className="table__secondary">{t.cash.checkedBy(row.checkedBy)}</span>}
            </>
          ),
        },
        {
          header: t.cash.countedBy,
          cell: (row: CashCount) => (
            <>
              {row.countedBy ?? '–'}
              {row.note && <span className="table__secondary">{row.note}</span>}
            </>
          ),
        },
      ]}
    />
  );
}

export function DifferenceBadge({ difference }: { difference: number | null }) {
  const t = useT();
  if (difference === null) return <Badge tone="neutral">{t.cash.nothingToCompare}</Badge>;
  if (Math.abs(difference) < CASH_TOLERANCE) return <Badge tone="ok">{t.cash.matches}</Badge>;
  return difference < 0 ? (
    <Badge tone="danger">{t.cash.short(formatMoney(-difference))}</Badge>
  ) : (
    <Badge tone="warn">{t.cash.over(formatMoney(difference))}</Badge>
  );
}


/** Count one drawer (float included); `drawer` picks which one first: "shop" or "carwash:<id>". */
export function CountForm({ drawer: initialDrawer = 'shop' }: { drawer?: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const today = useQuery({ queryKey: ['cash', 'today'], queryFn: cashApi.today });
  const { several } = useCarwashes();
  // Which drawer: "shop" or "carwash:<id>".
  const [drawer, setDrawer] = useState(initialDrawer);
  const [counted, setCounted] = useState('');
  // Null until someone changes it: then the drawer's usual float (or the one already counted today).
  const [floatInput, setFloatInput] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const input = { counted: Number(counted), float: Number(floatValue), note: note.trim() || null };
      return drawer === 'shop'
        ? cashApi.count({ place: 'shop', ...input })
        : cashApi.count({ place: 'carwash', carwashId: Number(drawer.split(':')[1]), ...input });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setCounted('');
      setFloatInput(null);
      setNote('');
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  const drawers = (today.data ?? []).map((entry) => ({
    key: entry.place === 'shop' ? 'shop' : `carwash:${entry.carwashId}`,
    label: entry.place === 'shop' ? t.cash.places.shop : carwashLabel(t.cash.places.carwash, entry.name, several),
    entry,
  }));
  const status = drawers.find((option) => option.key === drawer)?.entry;
  const floatValue = floatInput ?? String(status?.float ?? 0);
  const isValid = counted.trim() !== '' && Number(counted) >= 0 && floatValue.trim() !== '' && Number(floatValue) >= 0;

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="segmented" role="radiogroup" aria-label={t.cash.drawer}>
        {drawers.map((option) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={drawer === option.key}
            className="segmented__option"
            onClick={() => {
              setDrawer(option.key);
              setFloatInput(null);
              save.reset();
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="field-row">
        <Field label={t.cash.float} hint={t.cash.floatHint}>
          <input
            type="number"
            inputMode="decimal"
            required
            min={0}
            step={0.01}
            value={floatValue}
            onChange={(event) => setFloatInput(event.target.value)}
          />
        </Field>
        <Field label={t.cash.counted} hint={t.cash.countedHint(formatMoney(Number(floatValue) || 0))}>
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
      </div>
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
          {save.data.place === 'shop' ? t.cash.places.shop : carwashLabel(t.cash.places.carwash, save.data.carwashName, several)}:{' '}
          <DifferenceBadge difference={save.data.difference} />
        </p>
      )}
      <Button type="submit" variant="primary" disabled={!isValid || save.isPending}>
        {save.isPending ? t.cash.saving : t.cash.save}
      </Button>
    </form>
  );
}
