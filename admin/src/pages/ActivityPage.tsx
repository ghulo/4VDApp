import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { activityApi, usersApi } from '../services/api';
import { formatDateTime } from '../utils/format';

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
      <header className="page-header">
        <h1 className="page-title">Activity</h1>
        <p className="page-intro">Who changed what, newest first.</p>
      </header>

      <div className="toolbar">
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
      </div>

      {activity.isPending && <Loading />}
      {activity.isError && <ErrorNotice error={activity.error} onRetry={() => activity.refetch()} />}
      {activity.data && activity.data.items.length === 0 && (
        <EmptyState title="Nothing here yet">Changes show up here as people use the app.</EmptyState>
      )}
      {activity.data && activity.data.items.length > 0 && (
        <>
          <ul className="category-list">
            {activity.data.items.map((entry) => (
              <li key={entry.id} className="category-list__row activity-row">
                <div>
                  <p className="category-list__name">{entry.summary}</p>
                  <p className="category-list__description">{entry.user?.name ?? 'The system'}</p>
                </div>
                <span className="category-list__count">{formatDateTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
          <Pagination meta={activity.data.meta} itemLabel="changes" onPageChange={(next) => updateParams({ page: String(next) })} />
        </>
      )}
    </>
  );
}
