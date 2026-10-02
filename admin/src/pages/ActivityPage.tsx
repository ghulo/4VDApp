import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { activityApi, usersApi } from '../services/api';
import { formatDateTime } from '../utils/format';
import { DataTable, EmptyState, PageHeader } from '../components/ui';

/** Kinds of change a person would filter by, mapped to action prefixes. */
const KINDS = [
  { value: '', label: 'Everything' },
  { value: 'product,pricing,category', label: 'Products and prices' },
  { value: 'stock', label: 'Stock' },
  { value: 'sale', label: 'Sales' },
  { value: 'user', label: 'People' },
  { value: 'auth', label: 'Logins' },
];

export function ActivityPage() {
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
      <PageHeader title="Activity" description="Who changed what, newest first." />

      {activity.isPending && <Loading />}
      {activity.isError && <ErrorNotice error={activity.error} onRetry={() => activity.refetch()} />}
      {activity.data && (
        <DataTable
          caption="Activity"
          rows={activity.data.items}
          rowKey={(entry) => entry.id}
          columns={[
            { header: 'What changed', cell: (entry) => entry.summary },
            { header: 'Who', cell: (entry) => entry.user?.name ?? 'The system' },
            { header: 'When', cell: (entry) => formatDateTime(entry.createdAt), className: 'table__nowrap' },
          ]}
          toolbar={
            <>
              <select aria-label="Person" value={userId ?? ''} onChange={(event) => updateParams({ userId: event.target.value })}>
                <option value="">Everyone</option>
                {people.data?.items.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              <select aria-label="Kind of change" value={action} onChange={(event) => updateParams({ kind: event.target.value })}>
                {KINDS.map((kind) => (
                  <option key={kind.label} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </>
          }
          empty={<EmptyState title="Nothing here yet">Changes show up here as people use the app.</EmptyState>}
          footer={
            activity.data.items.length > 0 && (
              <Pagination
                meta={activity.data.meta}
                itemLabel="changes"
                onPageChange={(next) => updateParams({ page: String(next) })}
              />
            )
          }
        />
      )}
    </>
  );
}
