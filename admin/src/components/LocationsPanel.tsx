import { PencilSimple, Plus } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { locationsApi } from '../services/api';
import type { StockLocation } from '../services/types';
import { errorMessage } from '../utils/errors';
import { useLocations } from '../utils/useLocations';
import { ErrorNotice, Loading } from './Feedback';
import { Badge, Button, Card, Field, Sheet, useToast } from './ui';

/** Every screen that shows stock or asks where has to hear about a change here. */
function useRefreshLocations() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ['locations', 'inventory', 'reports', 'products', 'activity']) queryClient.invalidateQueries({ queryKey: [key] });
  };
}

/**
 * Where stock is kept, one row each: what it holds and whether the till sells
 * from it or goods come in there. Adding, renaming, those two choices and
 * removing an empty one happen in a side panel.
 */
export function LocationsPanel() {
  const t = useT();
  const locations = useLocations();
  const [editing, setEditing] = useState<StockLocation | 'new' | null>(null);

  return (
    <Card
      title={t.locations.title}
      description={t.locations.hint}
      flush
      actions={
        <Button icon={Plus} onClick={() => setEditing('new')}>
          {t.locations.add}
        </Button>
      }
    >
      {locations.isPending && <Loading />}
      {locations.isError && <ErrorNotice error={locations.error} onRetry={() => locations.refetch()} />}
      {locations.data && (
        <ul className="place-list place-list--wrap">
          {locations.locations.map((location) => (
            <li key={location.id} className="place-list__row">
              <span className="place-list__text">
                <span className="place-list__name">{location.name}</span>
                <span className="place-list__meta">{t.locations.holds(location.units, location.products)}</span>
              </span>
              {location.sellsHere && <Badge tone="ok">{t.locations.sellsHere}</Badge>}
              {location.receivesHere && <Badge tone="neutral">{t.locations.receivesHere}</Badge>}
              <Button size="sm" icon={PencilSimple} aria-label={t.locations.renameLabel(location.name)} onClick={() => setEditing(location)}>
                {t.locations.rename}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' || editing === null ? t.locations.add : editing.name}>
        {editing === 'new' ? <AddLocation onDone={() => setEditing(null)} /> : editing && <EditLocation location={editing} last={locations.locations.length <= 1} onDone={() => setEditing(null)} />}
      </Sheet>
    </Card>
  );
}

function AddLocation({ onDone }: { onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const refresh = useRefreshLocations();
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => locationsApi.create(name.trim()),
    onSuccess: (location) => {
      refresh();
      toast({ title: t.locations.added(location.name) });
      onDone();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) add.mutate();
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={t.locations.name}>
        <input required maxLength={60} placeholder={t.locations.namePlaceholder} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      {add.isError && (
        <p className="form-error" role="alert">
          {errorMessage(add.error)}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={!name.trim() || add.isPending} loading={add.isPending}>
        {t.locations.add}
      </Button>
    </form>
  );
}

function EditLocation({ location, last, onDone }: { location: StockLocation; last: boolean; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const refresh = useRefreshLocations();
  const [name, setName] = useState(location.name);
  const update = useMutation({
    mutationFn: (changes: { name?: string; sellsHere?: true; receivesHere?: true }) => locationsApi.update(location.id, changes),
    onSuccess: () => {
      refresh();
      toast({ title: t.locations.saved });
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: () => locationsApi.remove(location.id),
    onSuccess: () => {
      refresh();
      toast({ title: t.locations.removed(location.name) });
      onDone();
    },
  });
  // The server says why when it can't go (not empty, sells, receives); the button stays honest about the obvious cases.
  const canRemove = !last && !location.sellsHere && !location.receivesHere && location.units === 0;
  const busy = update.isPending || remove.isPending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() && name.trim() !== location.name) update.mutate({ name: name.trim() });
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <Field label={t.locations.name}>
        <input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      {(!location.sellsHere || !location.receivesHere) && (
        <div className="form-actions">
          {!location.sellsHere && (
            <Button disabled={busy} onClick={() => update.mutate({ sellsHere: true })}>
              {t.locations.makeSells}
            </Button>
          )}
          {!location.receivesHere && (
            <Button disabled={busy} onClick={() => update.mutate({ receivesHere: true })}>
              {t.locations.makeReceives}
            </Button>
          )}
        </div>
      )}
      {(update.isError || remove.isError) && (
        <p className="form-error" role="alert">
          {errorMessage(update.error ?? remove.error)}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={!name.trim() || name.trim() === location.name || busy} loading={update.isPending}>
          {t.locations.save}
        </Button>
        <span className="form-actions__danger">
          <Button variant="danger-text" disabled={!canRemove || busy} loading={remove.isPending} aria-label={t.locations.removeLabel(location.name)} onClick={() => remove.mutate()}>
            {t.locations.remove}
          </Button>
        </span>
      </div>
      <p className="field-hint">{t.locations.removeHint}</p>
    </form>
  );
}
