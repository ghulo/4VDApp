import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { activityApi, usersApi } from '../services/api';
import { formatDateTime } from '../utils/format';
import { Button, DataTable, EmptyState, PageHeader } from '../components/ui';
import { UndoConfirm } from '../components/activity/UndoConfirm';
import type { ActivityEntry } from '../services/types';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';

/**
 * Kinds of change a person would filter by, mapped to action prefixes. The
 * default leaves logins out: they outnumber real changes and bury what can be undone.
 */
const EVERYTHING = 'everything';
const KINDS: Array<{ value: string; key: keyof Catalogue['activity']['kinds'] }> = [
  { value: '', key: 'all' },
  { value: 'product,pricing,category', key: 'products' },
  { value: 'stock', key: 'stock' },
  { value: 'sale', key: 'sales' },
  { value: 'return', key: 'returns' },
  { value: 'write_off', key: 'damage' },
  { value: 'count', key: 'counts' },
  { value: 'user', key: 'people' },
  { value: 'auth', key: 'logins' },
  { value: EVERYTHING, key: 'everything' },
];

export function ActivityPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const userId = params.get('userId') ? Number(params.get('userId')) : undefined;
  const action = params.get('kind') ?? '';

  const people = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list(1) });
  const activity = useQuery({
    queryKey: ['activity', { page, userId, action }],
    queryFn: () =>
      activityApi.list({
        page,
        userId,
        action: action && action !== EVERYTHING ? action : undefined,
        exclude: action === '' ? 'auth' : undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const [open, setOpen] = useState<{ id: number; mode: 'undo' | 'restore' } | null>(null);

  function closeConfirm() {
    const id = open?.id;
    setOpen(null);
    // Back to the row's button, which now says Undo or Restore.
    requestAnimationFrame(() => document.getElementById(`undo-button-${id}`)?.focus());
  }

  function undoCell(entry: ActivityEntry) {
    const undo = entry.undo;
    if (!undo) return null;
    const mode = undo.state === 'undoable' ? 'undo' : undo.state === 'undone' && undo.allowed && undo.lockedReason === null ? 'restore' : null;
    if (mode) {
      const isOpen = open?.id === entry.id;
      return (
        <Button
          id={`undo-button-${entry.id}`}
          size="sm"
          variant={mode === 'undo' ? 'secondary' : 'ghost'}
          aria-expanded={isOpen}
          aria-controls={isOpen ? `undo-confirm-${entry.id}` : undefined}
          aria-label={mode === 'undo' ? t.undo.undoLabel(entry.summary) : t.undo.restoreLabel(entry.summary)}
          onClick={() => (isOpen ? setOpen(null) : setOpen({ id: entry.id, mode }))}
        >
          {mode === 'undo' ? t.undo.undo : t.undo.restore}
        </Button>
      );
    }
    if (undo.state === 'locked' || (undo.state === 'undone' && undo.lockedReason)) {
      return <span className="activity-undo__locked">{t.undo.locked[undo.lockedReason!]}</span>;
    }
    return null;
  }

  function summaryCell(entry: ActivityEntry) {
    if (entry.undo?.state !== 'undone') return entry.summary;
    const when = entry.undo.undoneAt ? formatDateTime(entry.undo.undoneAt) : '';
    return (
      <>
        <s className="activity-undo__struck">{entry.summary}</s>
        <span className="activity-undo__stamp">
          {entry.undo.undoneBy ? t.undo.undoneBy(entry.undo.undoneBy.name, when) : t.undo.undoneAt(when)}
          {entry.undo.note && <q className="activity-undo__note">{entry.undo.note}</q>}
        </span>
      </>
    );
  }

  function updateParams(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  }

  return (
    <>
      <PageHeader title={t.activity.title} description={t.activity.description} />

      {activity.isPending && <Loading />}
      {activity.isError && <ErrorNotice error={activity.error} onRetry={() => activity.refetch()} />}
      {activity.data && (
        <DataTable
          caption={t.activity.title}
          rows={activity.data.items}
          rowKey={(entry) => entry.id}
          columns={[
            { header: t.activity.whatChanged, cell: summaryCell },
            { header: t.activity.who, cell: (entry) => entry.user?.name ?? t.activity.system },
            { header: t.activity.when, cell: (entry) => formatDateTime(entry.createdAt), className: 'table__nowrap' },
            { header: <span className="visually-hidden">{t.undo.undo}</span>, cell: undoCell, align: 'end', className: 'table__nowrap' },
          ]}
          afterRow={(entry) =>
            open?.id === entry.id &&
            entry.undo && (
              <tr className="activity-undo__row">
                <td colSpan={4}>
                  <UndoConfirm
                    id={`undo-confirm-${entry.id}`}
                    entry={{ ...entry, undo: entry.undo }}
                    mode={open.mode}
                    onClose={closeConfirm}
                  />
                </td>
              </tr>
            )
          }
          toolbar={
            <>
              <select aria-label={t.activity.person} value={userId ?? ''} onChange={(event) => updateParams({ userId: event.target.value })}>
                <option value="">{t.activity.everyone}</option>
                {people.data?.items.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              <select aria-label={t.activity.kind} value={action} onChange={(event) => updateParams({ kind: event.target.value })}>
                {KINDS.map((kind) => (
                  <option key={kind.key} value={kind.value}>
                    {t.activity.kinds[kind.key]}
                  </option>
                ))}
              </select>
            </>
          }
          empty={<EmptyState title={t.activity.empty}>{t.activity.emptyHint}</EmptyState>}
          footer={
            activity.data.items.length > 0 && (
              <Pagination
                meta={activity.data.meta}
                itemLabel={t.activity.items}
                onPageChange={(next) => updateParams({ page: String(next) })}
              />
            )
          }
        />
      )}
    </>
  );
}
