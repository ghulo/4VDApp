import { useSearchParams } from 'react-router';
import { Drop } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ErrorNotice, Loading } from '../components/Feedback';
import { ManagersOnly } from '../components/ManagersOnly';
import { PeriodPicker } from '../components/PeriodPicker';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { carwashApi } from '../services/api';
import type { CarwashDay } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateWith, formatMoney } from '../utils/format';
import { useCarwashes } from '../utils/useCarwashes';
import { usePeriodParams } from '../utils/usePeriodParams';
import { Button, Card, DataTable, EmptyState, Field, PageHeader, StatGrid, StatTile } from '../components/ui';

/** "2026-10-04": today on this computer's calendar. */
const today = () => new Date().toLocaleDateString('en-CA');

/** "Sat 4 Oct" for a "2026-10-04" day, without any time zone moving it. */
const formatDay = (day: string) =>
  formatDateWith(new Date(`${day}T00:00:00Z`), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const FORM_ID = 'carwash-entry';

const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

/** The carwash: what it and its change machine made each day, beside the shop. */
export function CarwashPage() {
  const t = useT();
  const { period, from, to, range, rangeKey, changePeriod } = usePeriodParams('this-month');
  const { places, several } = useCarwashes();
  // "" = all carwashes together.
  const [which, setWhich] = useState('');
  const carwashId = several && which !== '' ? Number(which) : undefined;
  const takings = useQuery({
    queryKey: ['carwash', rangeKey, carwashId ?? 'all'],
    queryFn: () => carwashApi.list(rangeKey, carwashId),
    placeholderData: keepPreviousData,
  });
  const [editing, setEditing] = useState<CarwashDay | null>(null);

  return (
    <>
      <PageHeader
        title={t.nav.items.day}
        description={t.carwash.description(range.label)}
        actions={
          <>
            {several && (
              <select aria-label={t.carwash.which} value={which} onChange={(event) => setWhich(event.target.value)}>
                <option value="">{t.carwash.allCarwashes}</option>
                {places.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.name}
                  </option>
                ))}
              </select>
            )}
            <PeriodPicker period={period} from={from} to={to} onChange={changePeriod} />
          </>
        }
      />

      {takings.data && (
        <StatGrid>
          <StatTile label={t.carwash.carwash} value={formatMoney(takings.data.totals.carwash)} />
          <StatTile label={t.carwash.change} value={formatMoney(takings.data.totals.change)} hint={t.carwash.changeHint} />
          <StatTile
            label={t.carwash.total}
            value={formatMoney(takings.data.totals.total)}
            hint={t.carwash.daysEntered(takings.data.totals.days)}
          />
        </StatGrid>
      )}

      <ManagersOnly note={t.carwash.managersOnly}>
        <Card id={FORM_ID} title={t.carwash.enterDay}>
          {/* Keyed so picking "Edit" on a row starts the form afresh with that day. */}
          {/* Waits for the days, so a day that already has takings opens filled in. */}
          {takings.data && <TakingsForm key={`${editing?.carwashId ?? 'new'}-${editing?.day ?? 'new'}`} start={editing} days={takings.data.days} />}
        </Card>
      </ManagersOnly>

      {takings.isPending && <Loading />}
      {takings.isError && <ErrorNotice error={takings.error} onRetry={() => takings.refetch()} />}
      {takings.data && (
        <DaysTable
          days={takings.data.days}
          several={several}
          onEdit={(day) => {
            setEditing(day);
            document.getElementById(FORM_ID)?.scrollIntoView({ block: 'start' });
          }}
        />
      )}
    </>
  );
}

function TakingsForm({ start, days }: { start: CarwashDay | null; days: CarwashDay[] }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { places, several } = useCarwashes();
  // A link from the Day page names the carwash and day to enter (?carwash=2&day=2026-10-09).
  const [params] = useSearchParams();
  const askedDay = params.get('day') ?? today();
  // Which carwash this entry is for; only asked when there are several.
  const [carwashId, setCarwashId] = useState<number | null>(start?.carwashId ?? (Number(params.get('carwash')) || null));
  const chosen = carwashId ?? places[0]?.id ?? null;
  const forThisCarwash = days.filter((entry) => entry.carwashId === chosen);
  const initial = start ?? forThisCarwash.find((entry) => entry.day === askedDay);
  const [day, setDay] = useState(initial?.day ?? askedDay);
  const [carwash, setCarwash] = useState(initial ? String(initial.carwash) : '');
  const [change, setChange] = useState(initial ? String(initial.change) : '');
  const [savedDay, setSavedDay] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => carwashApi.save(chosen!, day, { carwash: Number(carwash), change: Number(change) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carwash'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      // The figures stay in the form: they are now that day's entry.
      setSavedDay(day);
    },
  });

  /** A day that already has takings fills the form with them, so saving is an edit. */
  function fillFrom(nextDay: string, nextCarwashId: number | null) {
    setSavedDay(null);
    const existing = days.find((entry) => entry.day === nextDay && entry.carwashId === nextCarwashId);
    if (existing) {
      setCarwash(String(existing.carwash));
      setChange(String(existing.change));
    }
  }
  function pickDay(next: string) {
    setDay(next);
    fillFrom(next, chosen);
  }
  function pickCarwash(next: number) {
    setCarwashId(next);
    fillFrom(day, next);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  const isAmount = (value: string) => value.trim() !== '' && Number(value) >= 0;
  const isValid = chosen !== null && day !== '' && day <= today() && isAmount(carwash) && isAmount(change);
  const alreadyEntered = forThisCarwash.some((entry) => entry.day === day);

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="field-row">
        {several && (
          <Field label={t.carwash.which}>
            <select value={chosen ?? ''} onChange={(event) => pickCarwash(Number(event.target.value))}>
              {places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t.carwash.day} narrow>
          <input type="date" required max={today()} value={day} onChange={(event) => pickDay(event.target.value)} />
        </Field>
      </div>
      <div className="field-row">
        <Field label={t.carwash.carwash} narrow>
          <input
            type="number"
            inputMode="decimal"
            required
            min={0}
            step={0.01}
            value={carwash}
            onChange={(event) => {
              setCarwash(event.target.value);
              setSavedDay(null);
            }}
          />
        </Field>
        <Field label={t.carwash.change} hint={t.carwash.changeHint} narrow>
          <input
            type="number"
            inputMode="decimal"
            required
            min={0}
            step={0.01}
            value={change}
            onChange={(event) => {
              setChange(event.target.value);
              setSavedDay(null);
            }}
          />
        </Field>
      </div>
      {alreadyEntered && !savedDay && <p className="field-hint">{t.carwash.replaces}</p>}
      {isAmount(carwash) && isAmount(change) && (
        <p className="field-hint">{t.carwash.dayTotal(formatMoney(roundMoney(Number(carwash) + Number(change))))}</p>
      )}
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      {savedDay && (
        <p className="form-success" role="status">
          {t.carwash.saved(formatDay(savedDay))}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={!isValid || save.isPending}>
        {save.isPending ? t.carwash.saving : t.carwash.save}
      </Button>
    </form>
  );
}

function DaysTable({ days, several, onEdit }: { days: CarwashDay[]; several: boolean; onEdit: (day: CarwashDay) => void }) {
  const t = useT();
  const { role } = useCurrentUser();
  const manager = canManage(role);

  return (
    <Card title={t.carwash.days} flush>
      <DataTable
        caption={t.carwash.caption}
        rows={days}
        rowKey={(row) => `${row.carwashId}-${row.day}`}
        empty={<EmptyState icon={Drop} title={t.carwash.none}>{t.carwash.noneHint}</EmptyState>}
        columns={[
          { header: t.carwash.day, cell: (row) => formatDay(row.day), title: true },
          ...(several ? [{ header: t.carwash.place, cell: (row: CarwashDay) => row.carwashName }] : []),
          { header: t.carwash.carwash, cell: (row) => formatMoney(row.carwash), align: 'end' },
          { header: t.carwash.change, cell: (row) => formatMoney(row.change), align: 'end' },
          { header: t.carwash.total, cell: (row) => formatMoney(row.total), align: 'end' },
          { header: t.carwash.enteredBy, cell: (row) => row.recordedBy ?? '–' },
          ...(manager
            ? [
                {
                  header: <span className="visually-hidden">{t.carwash.actions}</span>,
                  cell: (row: CarwashDay) => <RowActions row={row} onEdit={onEdit} />,
                },
              ]
            : []),
        ]}
      />
    </Card>
  );
}

function RowActions({ row, onEdit }: { row: CarwashDay; onEdit: (day: CarwashDay) => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => carwashApi.remove(row.carwashId, row.day),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carwash'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
  const label = formatDay(row.day);

  return (
    <div className="form-actions">
      {confirming ? (
        <>
          <Button variant="danger-text" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t.carwash.confirmRemove}
          </Button>
          <Button variant="ghost" disabled={remove.isPending} onClick={() => setConfirming(false)}>
            {t.carwash.keep}
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" aria-label={t.carwash.editLabel(label)} onClick={() => onEdit(row)}>
            {t.carwash.edit}
          </Button>
          <Button variant="danger-text" aria-label={t.carwash.removeLabel(label)} onClick={() => setConfirming(true)}>
            {t.carwash.remove}
          </Button>
        </>
      )}
      {remove.isError && (
        <p className="form-error" role="alert">
          {errorMessage(remove.error)}
        </p>
      )}
    </div>
  );
}
