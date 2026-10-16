import { ClockCounterClockwise } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { ActivityFeed } from '../components/activity/ActivityFeed';
import { Avatar } from '../components/Avatar';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { EmptyState, PageHeader } from '../components/ui';
import type { Catalogue } from '../i18n/en';
import { useT } from '../i18n/useT';
import { activityApi, usersApi } from '../services/api';

/**
 * Kinds of change a person would filter by, mapped to action prefixes. The
 * default leaves logins out: they outnumber real changes and bury what can be undone.
 */
const KINDS: Array<{ value: string; key: keyof Catalogue['activity']['kinds'] }> = [
  { value: '', key: 'all' },
  { value: 'sale,return,promotion,document', key: 'sales' },
  { value: 'product,pricing,category,stock,count,expiry,write_off', key: 'stock' },
  { value: 'order,bill,supplier', key: 'buying' },
  { value: 'cash,expense,carwash,customer,tab', key: 'money' },
  { value: 'user,settings,business', key: 'people' },
  { value: 'auth', key: 'logins' },
];

export function ActivityPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const userId = params.get('userId') ? Number(params.get('userId')) : undefined;
  // Old links named a single prefix ("kind=stock"); any value still filters.
  const action = params.get('kind') ?? '';
  const search = params.get('search') ?? '';

  const people = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list(1) });
  const activity = useQuery({
    queryKey: ['activity', { page, userId, action, search }],
    queryFn: () =>
      activityApi.list({
        page,
        userId,
        action: action || undefined,
        search: search || undefined,
        // Logins and issued invoices (one per checkout) would crowd the timeline; each has its own place.
        exclude: action === '' ? 'auth,document.issued' : undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const updateParams = useCallback(
    (changes: Record<string, string>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          if (!('page' in changes)) next.delete('page');
          return next;
        },
        { replace: !('page' in changes) },
      ),
    [setParams],
  );
  const onSearch = useCallback((value: string) => updateParams({ search: value }), [updateParams]);
  const filtered = Boolean(userId || action || search);

  return (
    <>
      <PageHeader wide title={t.activity.title} description={t.activity.description} />

      <div className="card activity-filters">
        <SearchInput value={search} onChange={onSearch} label={t.activity.search} />
        <div className="chip-row" role="radiogroup" aria-label={t.activity.person}>
          <button type="button" role="radio" aria-checked={!userId} className="chip" onClick={() => updateParams({ userId: '' })}>
            {t.activity.everyone}
          </button>
          {people.data?.items.map((person) => (
            <button
              key={person.id}
              type="button"
              role="radio"
              aria-checked={userId === person.id}
              className="chip chip--person"
              onClick={() => updateParams({ userId: userId === person.id ? '' : String(person.id) })}
            >
              <Avatar name={person.name} url={person.avatarUrl} size={24} />
              {person.name}
            </button>
          ))}
        </div>
        <div className="segmented segmented--small segmented--chips activity-filters__kinds" role="radiogroup" aria-label={t.activity.kind}>
          {KINDS.map((kind) => (
            <button
              key={kind.key}
              type="button"
              role="radio"
              aria-checked={action === kind.value}
              className="segmented__option"
              onClick={() => updateParams({ kind: kind.value })}
            >
              {t.activity.kinds[kind.key]}
            </button>
          ))}
        </div>
      </div>

      {activity.isPending && <Loading />}
      {activity.isError && <ErrorNotice error={activity.error} onRetry={() => activity.refetch()} />}
      {activity.data && activity.data.items.length === 0 && (
        <EmptyState icon={ClockCounterClockwise} title={filtered ? t.activity.noMatch : t.activity.empty}>
          {filtered ? t.activity.noMatchHint : t.activity.emptyHint}
        </EmptyState>
      )}
      {activity.data && activity.data.items.length > 0 && (
        <div className={activity.isPlaceholderData ? 'is-refreshing' : undefined} aria-busy={activity.isPlaceholderData}>
          <ActivityFeed entries={activity.data.items} people={people.data?.items} />
          <Pagination
            meta={activity.data.meta}
            itemLabel={t.activity.items}
            onPageChange={(next) => updateParams({ page: String(next) })}
          />
        </div>
      )}
    </>
  );
}
