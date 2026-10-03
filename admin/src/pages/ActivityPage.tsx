import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { activityApi, usersApi } from '../services/api';
import { formatDateTime } from '../utils/format';
import { DataTable, EmptyState, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';
import type { Catalogue } from '../i18n/en';

/** Kinds of change a person would filter by, mapped to action prefixes. */
const KINDS: Array<{ value: string; key: keyof Catalogue['activity']['kinds'] }> = [
  { value: '', key: 'all' },
  { value: 'product,pricing,category', key: 'products' },
  { value: 'stock', key: 'stock' },
  { value: 'sale', key: 'sales' },
  { value: 'user', key: 'people' },
  { value: 'auth', key: 'logins' },
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
    queryFn: () => activityApi.list({ page, userId, action: action || undefined }),
    placeholderData: keepPreviousData,
  });

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
            { header: t.activity.whatChanged, cell: (entry) => entry.summary },
            { header: t.activity.who, cell: (entry) => entry.user?.name ?? t.activity.system },
            { header: t.activity.when, cell: (entry) => formatDateTime(entry.createdAt), className: 'table__nowrap' },
          ]}
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
