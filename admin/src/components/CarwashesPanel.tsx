import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { carwashApi } from '../services/api';
import type { Carwash } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading } from './Feedback';
import { Badge, Button, Card, Field } from './ui';

/** Everything that shows carwash figures or choices has to hear about a change here. */
function useRefreshCarwashes() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ['carwash', 'cash', 'expenses', 'reports', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
  };
}

/** The carwashes the business runs: add one, rename it, set its cash float, or archive it. */
export function CarwashesPanel() {
  const t = useT();
  const carwashes = useQuery({ queryKey: ['carwash', 'places', 'all'], queryFn: () => carwashApi.places(true) });
  const open = carwashes.data?.filter((carwash) => !carwash.archived).length ?? 0;

  return (
    <Card title={t.carwashes.title} description={t.carwashes.description}>
      {carwashes.isPending && <Loading />}
      {carwashes.isError && <ErrorNotice error={carwashes.error} onRetry={() => carwashes.refetch()} />}
      {carwashes.data?.map((carwash) => (
        <CarwashRow key={carwash.id} carwash={carwash} onlyOpenOne={!carwash.archived && open === 1} />
      ))}
      <AddCarwash />
    </Card>
  );
}

function CarwashRow({ carwash, onlyOpenOne }: { carwash: Carwash; onlyOpenOne: boolean }) {
  const t = useT();
  const refresh = useRefreshCarwashes();
  const [name, setName] = useState(carwash.name);
  const [cashFloat, setCashFloat] = useState(String(carwash.cashFloat));
  const update = useMutation({
    mutationFn: (changes: { name?: string; cashFloat?: number; archived?: boolean }) => carwashApi.updatePlace(carwash.id, changes),
    onSuccess: refresh,
  });

  const isValid = name.trim() !== '' && cashFloat.trim() !== '' && Number(cashFloat) >= 0;
  const hasChanges = name.trim() !== carwash.name || Number(cashFloat) !== carwash.cashFloat;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    update.mutate({ name: name.trim(), cashFloat: Number(cashFloat) });
  }

  return (
    <form className="setting-row setting-row--fields" onSubmit={handleSubmit} aria-label={carwash.name}>
      <div className="field-row">
        <Field label={t.carwashes.name}>
          <input required maxLength={80} value={name} disabled={carwash.archived} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t.carwashes.float} narrow>
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
      </div>
      <div className="form-actions">
        {carwash.archived ? (
          <>
            <Badge tone="neutral">{t.carwashes.archived}</Badge>
            <Button disabled={update.isPending} onClick={() => update.mutate({ archived: false })}>
              {t.carwashes.restore}
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" variant={hasChanges ? 'primary' : 'secondary'} disabled={!isValid || !hasChanges || update.isPending}>
              {update.isPending ? t.settings.saving : t.carwashes.save}
            </Button>
            <Button
              variant="danger-text"
              disabled={onlyOpenOne || update.isPending}
              title={onlyOpenOne ? t.carwashes.keepOne : undefined}
              aria-label={t.carwashes.archiveLabel(carwash.name)}
              onClick={() => update.mutate({ archived: true })}
            >
              {t.carwashes.archive}
            </Button>
          </>
        )}
        {update.isSuccess && !hasChanges && (
          <span className="form-success" role="status">
            {t.settings.saved}
          </span>
        )}
      </div>
      {update.isError && (
        <p className="form-error" role="alert">
          {errorMessage(update.error)}
        </p>
      )}
    </form>
  );
}

function AddCarwash() {
  const t = useT();
  const refresh = useRefreshCarwashes();
  const [name, setName] = useState('');
  const [cashFloat, setCashFloat] = useState('0');
  const add = useMutation({
    mutationFn: () => carwashApi.addPlace({ name: name.trim(), cashFloat: Number(cashFloat) }),
    onSuccess: () => {
      refresh();
      setName('');
      setCashFloat('0');
    },
  });
  const isValid = name.trim() !== '' && cashFloat.trim() !== '' && Number(cashFloat) >= 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    add.mutate();
  }

  return (
    <form className="setting-row setting-row--fields" onSubmit={handleSubmit} aria-label={t.carwashes.add}>
      <div className="field-row">
        <Field label={t.carwashes.newName}>
          <input maxLength={80} placeholder={t.carwashes.namePlaceholder} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t.carwashes.float} narrow>
          <input type="number" inputMode="decimal" min={0} step={0.01} value={cashFloat} onChange={(event) => setCashFloat(event.target.value)} />
        </Field>
      </div>
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!isValid || add.isPending}>
          {add.isPending ? t.settings.saving : t.carwashes.add}
        </Button>
        {add.isSuccess && (
          <span className="form-success" role="status">
            {t.carwashes.added}
          </span>
        )}
      </div>
      {add.isError && (
        <p className="form-error" role="alert">
          {errorMessage(add.error)}
        </p>
      )}
    </form>
  );
}
