import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useLocation } from 'react-router';
import { CountForm } from '../../components/CashCount';
import { DayChecklist } from '../../components/DayChecklist';
import { ErrorNotice, Loading, SavedToast } from '../../components/Feedback';
import { Button, Field, PageHeader, Sheet } from '../../components/ui';
import { useT } from '../../i18n/useT';
import { teamApi } from '../../services/teamApi';
import { errorMessage } from '../../utils/errors';
import { formatMoney } from '../../utils/format';
import { useDayChecklist } from '../../utils/useDayChecklist';

const toNumber = (value: string) => Number(value.replace(',', '.'));
const roundMoney = (amount: number) => Math.round(amount * 100) / 100;
const isAmount = (value: string) => value.trim() !== '' && Number.isFinite(toNumber(value)) && toNumber(value) >= 0;

/**
 * End your shift: the steps closed at the counter (each drawer counted, each
 * carwash's takings entered), from the same list the Day page reads. Each
 * open step opens its form in a side panel.
 */
export function EndShiftPage() {
  const t = useT();
  const location = useLocation();
  const day = useDayChecklist();
  const [counting, setCounting] = useState<string | null>(null);
  // "Carwash takings" on Home lands here with #carwash: open the first carwash at once.
  const [carwash, setCarwash] = useState<number | 'first' | null>(location.hash === '#carwash' ? 'first' : null);

  return (
    <>
      <Sheet open={counting !== null} onClose={() => setCounting(null)} title={t.cash.countTitle}>
        {counting !== null && <CountForm key={counting} drawer={counting} />}
      </Sheet>
      <Sheet open={carwash !== null} onClose={() => setCarwash(null)} title={t.staff.carwash.title}>
        {carwash !== null && <CarwashTakingsForm carwashId={carwash === 'first' ? null : carwash} onDone={() => setCarwash(null)} />}
      </Sheet>
      <PageHeader title={t.staff.shift.title} description={t.staff.shift.intro} crumbs={[{ label: t.staff.nav.home, to: '/' }]} />
      {day.isPending && <Loading />}
      {day.isError && <ErrorNotice error={day.error} onRetry={() => day.refetch()} />}
      {day.data && <DayChecklist day={day.data} onCountDrawer={setCounting} onEnterCarwash={setCarwash} />}
    </>
  );
}

/** Today's takings for one carwash: the wash and the change machine. Entering again replaces them. */
function CarwashTakingsForm({ carwashId, onDone }: { carwashId: number | null; onDone: () => void }) {
  const t = useT();
  const today = useQuery({ queryKey: ['carwash', 'today'], queryFn: teamApi.carwashToday });
  const [picked, setPicked] = useState<number | null>(carwashId);
  if (today.isPending) return <Loading />;
  if (today.isError) return <ErrorNotice error={today.error} onRetry={() => today.refetch()} />;
  const { carwashes, day } = today.data;
  const chosen = carwashes.find((entry) => entry.id === picked) ?? carwashes[0];
  if (!chosen) return <p className="staff-muted">{t.staff.carwash.none}</p>;
  const several = carwashes.length > 1;
  return (
    <div className="staff-page">
      {several && (
        <div className="segmented" role="radiogroup" aria-label={t.staff.carwash.which}>
          {carwashes.map((entry) => (
            <button key={entry.id} type="button" role="radio" aria-checked={entry.id === chosen.id} className="segmented__option" onClick={() => setPicked(entry.id)}>
              {entry.name}
            </button>
          ))}
        </div>
      )}
      {/* A fresh form for each carwash, so its own figures show. */}
      <TakingsFields key={`${chosen.id}-${day}`} carwashId={chosen.id} name={several ? chosen.name : null} day={day} start={chosen.takings} onDone={onDone} />
    </div>
  );
}

function TakingsFields(props: { carwashId: number; name: string | null; day: string; start: { carwash: number; change: number } | null; onDone: () => void }) {
  const { carwashId, name, day, start, onDone } = props;
  const t = useT();
  const queryClient = useQueryClient();
  const [carwash, setCarwash] = useState(start ? String(start.carwash) : '');
  const [change, setChange] = useState(start ? String(start.change) : '');
  const valid = isAmount(carwash) && isAmount(change);
  const total = valid ? roundMoney(toNumber(carwash) + toNumber(change)) : null;
  const save = useMutation({
    mutationFn: () => teamApi.saveCarwash(carwashId, day, { carwash: toNumber(carwash), change: toNumber(change) }),
    onSuccess: () => {
      for (const key of ['carwash', 'cash', 'attention', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  if (save.isSuccess && total !== null) {
    return (
      <div className="staff-page">
        <SavedToast message={t.staff.carwash.saved(formatMoney(total), name)} />
        <Button variant="primary" onClick={onDone}>
          {t.staff.done}
        </Button>
      </div>
    );
  }

  return (
    <form className="settings-form" onSubmit={submit}>
      <p className="staff-muted">{start ? t.staff.carwash.alreadyEntered : t.staff.carwash.intro}</p>
      <div className="field-row">
        <Field label={t.staff.carwash.carwash}>
          <input type="text" inputMode="decimal" placeholder="0,00" value={carwash} onChange={(event) => setCarwash(event.target.value)} />
        </Field>
        <Field label={t.staff.carwash.change}>
          <input type="text" inputMode="decimal" placeholder="0,00" value={change} onChange={(event) => setChange(event.target.value)} />
        </Field>
      </div>
      {total !== null && <p className="staff-row__value">{t.staff.carwash.total(formatMoney(total))}</p>}
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={!valid} loading={save.isPending}>
        {t.staff.carwash.save}
      </Button>
    </form>
  );
}
