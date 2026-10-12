import { Drop, PencilSimple, Plus } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { carwashApi } from '../services/api';
import type { Carwash } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading } from './Feedback';
import { formatMoney } from '../utils/format';
import { Badge, Button, Card, Field, Sheet } from './ui';

/** Everything that shows carwash figures or choices has to hear about a change here. */
function useRefreshCarwashes() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ['carwash', 'cash', 'expenses', 'reports', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
  };
}
/** The carwashes the business runs, one row each; adding and editing happen in a side panel. */
export function CarwashesPanel() {
  const t = useT();
  const carwashes = useQuery({ queryKey: ['carwash', 'places', 'all'], queryFn: () => carwashApi.places(true) });
  const [editing, setEditing] = useState<Carwash | 'new' | null>(null);
  const open = carwashes.data?.filter((carwash) => !carwash.archived).length ?? 0;

  return (
    <Card
      title={t.carwashes.title}
      description={t.carwashes.description}
      flush
      actions={
        <Button icon={Plus} onClick={() => setEditing('new')}>
          {t.carwashes.add}
        </Button>
      }
    >
      {carwashes.isPending && <Loading />}
      {carwashes.isError && <ErrorNotice error={carwashes.error} onRetry={() => carwashes.refetch()} />}
      {carwashes.data && (
        <ul className="place-list">
          {carwashes.data.map((carwash) => (
            <li key={carwash.id} className={`place-list__row${carwash.archived ? ' place-list__row--archived' : ''}`}>
              <span className="place-list__icon" aria-hidden="true">
                <Drop size={18} />
              </span>
              <span className="place-list__text">
                <span className="place-list__name">{carwash.name}</span>
                <span className="place-list__meta">{t.carwashes.floatIs(formatMoney(carwash.cashFloat))}</span>
              </span>
              {carwash.archived && <Badge tone="neutral">{t.carwashes.archived}</Badge>}
              <Button size="sm" icon={PencilSimple} aria-label={t.carwashes.editLabel(carwash.name)} onClick={() => setEditing(carwash)}>
                {t.carwashes.edit}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' || editing === null ? t.carwashes.add : editing.name}
        description={editing === 'new' ? t.carwashes.addHint : undefined}
      >
        {editing === 'new' ? (
          <AddCarwash onDone={() => setEditing(null)} />
        ) : (
          editing && <EditCarwash carwash={editing} onlyOpenOne={!editing.archived && open === 1} onDone={() => setEditing(null)} />
        )}
      </Sheet>
    </Card>
  );
}

function EditCarwash({ carwash, onlyOpenOne, onDone }: { carwash: Carwash; onlyOpenOne: boolean; onDone: () => void }) {
  const t = useT();
  const refresh = useRefreshCarwashes();
  const [name, setName] = useState(carwash.name);
  const [cashFloat, setCashFloat] = useState(String(carwash.cashFloat));
  const update = useMutation({
    mutationFn: (changes: { name?: string; cashFloat?: number; archived?: boolean }) => carwashApi.updatePlace(carwash.id, changes),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });

  const isValid = name.trim() !== '' && cashFloat.trim() !== '' && Number(cashFloat) >= 0;
  const hasChanges = name.trim() !== carwash.name || Number(cashFloat) !== carwash.cashFloat;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    update.mutate({ name: name.trim(), cashFloat: Number(cashFloat) });
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={t.carwashes.name}>
        <input required maxLength={80} value={name} disabled={carwash.archived} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label={t.carwashes.float} hint={t.carwashes.floatHint}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          value={cashFloat}
          disabled={carwash.archived}
          onChange={(event) => setCashFloat(event.target.value)}
        />
      </Field>
      {update.isError && (
        <p className="form-error" role="alert">
          {errorMessage(update.error)}
        </p>
      )}
      <div className="form-actions">
        {carwash.archived ? (
          <Button variant="primary" disabled={update.isPending} onClick={() => update.mutate({ archived: false })}>
            {t.carwashes.restore}
          </Button>
        ) : (
          <>
            <Button type="submit" variant="primary" disabled={!isValid || !hasChanges || update.isPending}>
              {update.isPending ? t.settings.saving : t.carwashes.save}
            </Button>
            <span className="form-actions__danger">
              <Button
                variant="danger-text"
                disabled={onlyOpenOne || update.isPending}
                aria-label={t.carwashes.archiveLabel(carwash.name)}
                onClick={() => update.mutate({ archived: true })}
              >
                {t.carwashes.archive}
              </Button>
            </span>
          </>
        )}
      </div>
      {onlyOpenOne && <p className="field-hint">{t.carwashes.keepOne}</p>}
    </form>
  );
}

function AddCarwash({ onDone }: { onDone: () => void }) {
  const t = useT();
  const refresh = useRefreshCarwashes();
  const [name, setName] = useState('');
  const [cashFloat, setCashFloat] = useState('0');
  const add = useMutation({
    mutationFn: () => carwashApi.addPlace({ name: name.trim(), cashFloat: Number(cashFloat) }),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });
  const isValid = name.trim() !== '' && cashFloat.trim() !== '' && Number(cashFloat) >= 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    add.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={t.carwashes.name}>
        <input required maxLength={80} placeholder={t.carwashes.namePlaceholder} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label={t.carwashes.float} hint={t.carwashes.floatHint}>
        <input type="number" inputMode="decimal" min={0} step={0.01} value={cashFloat} onChange={(event) => setCashFloat(event.target.value)} />
      </Field>
      {add.isError && (
        <p className="form-error" role="alert">
          {errorMessage(add.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!isValid || add.isPending}>
          {add.isPending ? t.settings.saving : t.carwashes.add}
        </Button>
      </div>
    </form>
  );
}
