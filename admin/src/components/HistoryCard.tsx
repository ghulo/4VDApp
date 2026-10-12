import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { canOversee } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { activityApi } from '../services/api';
import type { ActivityEntry, FieldChange, HistoryEntity, UserRole } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateTime, formatMoney } from '../utils/format';
import { CountryFlag, useCountries } from './CountryFlag';
import { ErrorNotice, Loading } from './Feedback';
import { Badge, Button, Card } from './ui';

/** Newest few first; the rest behind "Show all", so a long-lived product doesn't push the page down. */
const SHOWN = 8;

/** Records the developer can put back to an earlier point (the API checks the same). */
const RESTORABLE: HistoryEntity[] = ['product', 'user', 'supplier', 'customer', 'business'];

const MONEY_FIELDS = new Set(['price', 'costPrice', 'monthlyTarget']);

/** One changed value as people read it: money as money, a country by name, a role by its title. */
function useValueText() {
  const t = useT();
  const countries = useCountries();
  return (field: string, raw: unknown): string => {
    if (raw === null || raw === undefined || raw === '') return t.history.nothing;
    if (MONEY_FIELDS.has(field) && typeof raw === 'number') return formatMoney(raw);
    if (field === 'originCountry' && typeof raw === 'string') return countries.name(raw);
    if (field === 'imageUrl') return t.history.aPhoto;
    if (field === 'role' && typeof raw === 'string') return t.common.roles[raw as UserRole] ?? raw;
    if (typeof raw === 'boolean') return raw ? t.history.yes : t.history.no;
    if (field === 'bulkPricingTiers' && Array.isArray(raw)) {
      return raw.length === 0 ? t.history.nothing : raw.map((tier: { quantity: number; price: number }) => `${tier.quantity}+ ${formatMoney(tier.price)}`).join(', ');
    }
    return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  };
}

function ChangeLine({ change }: { change: FieldChange }) {
  const t = useT();
  const text = useValueText();
  return (
    <span className="record-history__change">
      {change.field === 'originCountry' && typeof change.to === 'string' && <CountryFlag code={change.to} decorative />}
      {t.history.change({ field: t.history.fields[change.field] ?? change.field, from: text(change.field, change.from), to: text(change.field, change.to) })}
    </span>
  );
}

/**
 * Everything that happened to one record, read from the activity log: who did
 * what and when, undos included. People who run the shop see it; the log can't
 * be edited. The developer can put the record back to any earlier point.
 */
export function HistoryCard({ entityType, entityId }: { entityType: HistoryEntity; entityId: number }) {
  const t = useT();
  const { role } = useCurrentUser();
  const allowed = canOversee(role);
  const [all, setAll] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const panelId = useId();
  const history = useQuery({
    queryKey: ['activity', 'history', entityType, entityId],
    queryFn: () => activityApi.history(entityType, entityId),
    enabled: allowed,
  });
  if (!allowed) return null;

  // Logins are about using an account, not changes to it; Activity keeps them.
  const entries = [...(history.data ?? [])].filter((entry) => !entry.action.startsWith('auth.')).reverse();
  const shown = all ? entries : entries.slice(0, SHOWN);
  const own = (entry: ActivityEntry) => entry.entityType === entityType && entry.entityId === entityId;
  // Restoring to the newest change would change nothing, so it gets no button.
  const newestOwn = entries.find(own)?.id;
  const canRestore = (entry: ActivityEntry) => role === 'developer' && RESTORABLE.includes(entityType) && own(entry) && entry.id !== newestOwn;
  // Focus goes back to the entry's button once its panel closes.
  function closeRestore(id: number) {
    setRestoring(null);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-restore="${id}"]`)?.focus());
  }
  const when = (id: unknown) => {
    const point = entries.find((entry) => entry.id === id);
    return point ? formatDateTime(point.createdAt) : null;
  };

  return (
    <Card title={t.history.title} description={t.history.description} className="record-history-card">
      {history.isPending ? (
        <Loading />
      ) : history.isError ? (
        <ErrorNotice error={history.error} onRetry={() => history.refetch()} />
      ) : entries.length === 0 ? (
        <p className="field-hint">{t.history.empty}</p>
      ) : (
        <>
          <ol className="record-history">
            {shown.map((entry) => {
              const restoredTo = entry.details?.restoredTo;
              return (
                <li key={entry.id} className={entry.undo?.state === 'undone' ? 'record-history__entry is-undone' : 'record-history__entry'}>
                  <span className="record-history__when">
                    <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                    {entry.user && <span> · {t.history.by(entry.user.name)}</span>}
                  </span>
                  <span className="record-history__what">
                    <span className="record-history__text">{entry.summary}</span>
                    {entry.undo?.state === 'undone' && <Badge tone="neutral">{t.history.undone}</Badge>}
                    {restoredTo !== undefined && when(restoredTo) && <Badge tone="info">{t.history.restoredTo(when(restoredTo)!)}</Badge>}
                  </span>
                  {(entry.changes ?? []).map((change) => (
                    <ChangeLine key={change.field} change={change} />
                  ))}
                  {canRestore(entry) &&
                    (restoring === entry.id ? (
                      <RestorePanel id={panelId} entryId={entry.id} onClose={() => closeRestore(entry.id)} />
                    ) : (
                      <span>
                        <Button size="sm" variant="ghost" data-restore={entry.id} onClick={() => setRestoring(entry.id)}>
                          {t.history.restore.button}
                          <span className="visually-hidden"> ({formatDateTime(entry.createdAt)})</span>
                        </Button>
                      </span>
                    ))}
                </li>
              );
            })}
          </ol>
          {entries.length > SHOWN && (
            <Button size="sm" variant="ghost" onClick={() => setAll((current) => !current)}>
              {all ? t.history.showFewer : t.history.showAll(entries.length)}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * Two steps, so a restore is never one click: first what goes back, field by
 * field, then "Are you sure?". The server refuses if the record changed in between.
 */
function RestorePanel({ id, entryId, onClose }: { id: string; entryId: number; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [sure, setSure] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const plan = useQuery({ queryKey: ['activity', 'restore-plan', entryId], queryFn: () => activityApi.restorePlan(entryId), gcTime: 0 });
  const restore = useMutation({
    mutationFn: () => activityApi.restoreTo(entryId, plan.data!.latestEntryId),
    // Any page can show the restored record (product, person, supplier, customer, shop), so everything refreshes.
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      onClose();
    },
    // Changed meanwhile: show the fresh plan, back at step one.
    onError: () => {
      setSure(false);
      void plan.refetch();
    },
  });

  useEffect(() => headingRef.current?.focus(), []);
  useEffect(() => {
    if (sure) confirmRef.current?.focus();
  }, [sure]);

  function closeOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape' && !restore.isPending) {
      event.stopPropagation();
      onClose();
    }
  }

  const changes = plan.data?.changes ?? [];
  return (
    <div id={id} className="undo-confirm record-restore" role="group" aria-labelledby={headingId} aria-busy={plan.isFetching || restore.isPending} onKeyDown={closeOnEscape}>
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="undo-confirm__title">
        {t.history.restore.title}
      </h3>
      {plan.isPending ? (
        <p className="field-hint">{t.history.restore.checking}</p>
      ) : plan.isError ? (
        <ErrorNotice error={plan.error} onRetry={() => plan.refetch()} />
      ) : changes.length === 0 ? (
        <p className="field-hint">{t.history.restore.nothing}</p>
      ) : (
        <>
          <p>{t.history.restore.intro(changes.length)}</p>
          <ul className="undo-confirm__effects">
            {changes.map((change) => (
              <li key={change.field}>
                <ChangeLine change={change} />
              </li>
            ))}
          </ul>
          {sure && (
            <p className="record-restore__warning" role="alert">
              {t.history.restore.sure}
            </p>
          )}
        </>
      )}
      {restore.isError && (
        <p className="form-error" role="alert">
          {errorMessage(restore.error)}
        </p>
      )}
      <div className="undo-confirm__buttons">
        {changes.length > 0 &&
          (sure ? (
            <Button ref={confirmRef} variant="danger" disabled={restore.isPending} onClick={() => restore.mutate()}>
              {restore.isPending ? t.history.restore.working : t.history.restore.confirm}
            </Button>
          ) : (
            <Button variant="primary" disabled={plan.isFetching} onClick={() => setSure(true)}>
              {t.history.restore.next}
            </Button>
          ))}
        <Button onClick={onClose} disabled={restore.isPending}>
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}
