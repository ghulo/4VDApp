import { CaretDown, ClockCounterClockwise, Gear, Hammer } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useSwitchBusiness } from '../auth/useBusinessPicker';
import { ACTIVITY_ICONS, ACTIVITY_KINDS } from '../components/activity/activityKinds';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { Badge, Button, DeveloperMark, EmptyState, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';
import { allLogsApi, type AllLogsEntry, type AllLogsVisit, type SupportAction } from '../services/api';
import { dayHeading, formatDateTime, formatTime, groupByDay } from '../utils/format';

/** The extra chip after History's kinds: the developer's own support visits, a list of its own. */
const SUPPORT = 'support';

/**
 * All logs (4VD's developer only): every business's history in one feed, and
 * the support visits. Read-only: undo stays inside the business. Each read is
 * logged on the server.
 */
export function AllLogsPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const businessId = params.get('business') ? Number(params.get('business')) : undefined;
  const kind = params.get('kind') ?? '';
  const search = params.get('search') ?? '';
  const support = kind === SUPPORT;

  const businesses = useQuery({ queryKey: ['all-logs', 'businesses'], queryFn: allLogsApi.businesses });
  const activity = useQuery({
    queryKey: ['all-logs', 'activity', { page, businessId, kind, search }],
    queryFn: () =>
      allLogsApi.activity({
        page,
        businessId,
        action: kind || undefined,
        search: search || undefined,
        // Like History: logins and issued invoices would crowd the feed.
        exclude: kind === '' ? 'auth,document.issued' : undefined,
      }),
    enabled: !support,
    placeholderData: keepPreviousData,
  });
  const visits = useQuery({
    queryKey: ['all-logs', 'support', { page, businessId }],
    queryFn: () => allLogsApi.support({ page, businessId }),
    enabled: support,
    placeholderData: keepPreviousData,
  });
  const list = support ? visits : activity;

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
  const filtered = Boolean(businessId || (kind && !support) || (search && !support));

  return (
    <>
      <PageHeader title={t.allLogs.title} description={t.allLogs.description} />

      <div className="card activity-filters">
        {!support && (
          <div className="toolbar">
            <SearchInput value={search} onChange={onSearch} label={t.allLogs.search} />
          </div>
        )}
        <div className="chip-row" role="radiogroup" aria-label={t.allLogs.business}>
          <button type="button" role="radio" aria-checked={!businessId} className="chip" onClick={() => updateParams({ business: '' })}>
            {t.allLogs.everyBusiness}
          </button>
          {businesses.data?.map((business) => (
            <button
              key={business.id}
              type="button"
              role="radio"
              aria-checked={businessId === business.id}
              className="chip"
              title={business.shortName ? `bills+${business.shortName}@4vd.app` : undefined}
              onClick={() => updateParams({ business: businessId === business.id ? '' : String(business.id) })}
            >
              {business.name}
            </button>
          ))}
        </div>
        <div className="segmented segmented--small segmented--chips activity-filters__kinds" role="radiogroup" aria-label={t.activity.kind}>
          {ACTIVITY_KINDS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={kind === option.value}
              className="segmented__option"
              onClick={() => updateParams({ kind: option.value })}
            >
              {t.activity.kinds[option.key]}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={support} className="segmented__option" onClick={() => updateParams({ kind: SUPPORT, search: '' })}>
            {t.allLogs.supportVisits}
          </button>
        </div>
      </div>

      {list.isPending && <Loading />}
      {list.isError && <ErrorNotice error={list.error} onRetry={() => list.refetch()} />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState icon={support ? Hammer : ClockCounterClockwise} title={filtered ? t.activity.noMatch : support ? t.allLogs.noVisits : t.activity.empty}>
          {filtered ? t.allLogs.noMatchHint : support ? t.allLogs.noVisitsHint : t.activity.emptyHint}
        </EmptyState>
      )}
      {list.data && list.data.items.length > 0 && (
        <div className={list.isPlaceholderData ? 'is-refreshing' : undefined} aria-busy={list.isPlaceholderData}>
          {support ? <VisitList visits={visits.data!.items} /> : <AllLogsFeed entries={activity.data!.items} />}
          <Pagination
            meta={list.data.meta}
            itemLabel={support ? t.allLogs.visitItems : t.activity.items}
            onPageChange={(next) => updateParams({ page: String(next) })}
          />
        </div>
      )}
    </>
  );
}

/** Opens a business the way the account menu's picker does (the visit is logged there as usual). */
function OpenBusiness({ business }: { business: { id: number; name: string } }) {
  const t = useT();
  const switchBusiness = useSwitchBusiness();
  const [opening, setOpening] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={opening}
      aria-label={t.allLogs.openLabel(business.name)}
      onClick={() => {
        setOpening(true);
        void switchBusiness(business.id).finally(() => setOpening(false));
      }}
    >
      {opening ? t.allLogs.opening : t.allLogs.open}
    </Button>
  );
}

/** History's rows, gathered by day, each tagged with its business. No links: records live inside their business. */
function AllLogsFeed({ entries }: { entries: AllLogsEntry[] }) {
  const t = useT();
  return (
    <>
      {groupByDay(entries, (entry) => entry.createdAt).map((group) => (
        <section key={group.day} className="day-group" aria-labelledby={`all-logs-${group.day}`}>
          <h2 id={`all-logs-${group.day}`} className="day-group__heading">
            {dayHeading(group.day, t.periods.options)}
          </h2>
          <ul className="activity-feed">
            {group.rows.map((entry) => {
              const KindIcon = ACTIVITY_ICONS[entry.action.split('.')[0] ?? ''] ?? Gear;
              const undone = entry.undoneAt !== null;
              return (
                <li key={`${entry.business.id}-${entry.id}`} className={`activity-feed__row${undone ? ' activity-feed__row--undone' : ''}`}>
                  <span className="activity-feed__icon" aria-hidden="true">
                    <KindIcon size={18} />
                  </span>
                  <span className="activity-feed__text">
                    <span className="activity-feed__summary">{undone ? <s className="activity-undo__struck">{entry.summary}</s> : entry.summary}</span>
                    <span className="activity-feed__meta">
                      <Badge>{entry.business.name}</Badge>
                      <span aria-hidden="true">·</span>
                      {entry.user ? (
                        <span className="activity-feed__person">
                          {entry.user.name}
                          {entry.user.isDeveloper && <DeveloperMark size="glyph" />}
                        </span>
                      ) : (
                        <span>{t.activity.system}</span>
                      )}
                      <span aria-hidden="true">·</span>
                      <time dateTime={entry.createdAt}>{formatTime(entry.createdAt)}</time>
                    </span>
                    {undone && entry.undoneAt && <span className="activity-undo__stamp">{t.undo.undoneAt(formatDateTime(entry.undoneAt))}</span>}
                  </span>
                  <span className="activity-feed__actions">
                    <OpenBusiness business={entry.business} />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

/** The support visits, newest first; each opens to the changes made in it. */
function VisitList({ visits }: { visits: AllLogsVisit[] }) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  const describe = (action: SupportAction) => {
    const failed = action.status !== null && action.status >= 400;
    return `${t.support.action(action.method, action.entity, action.entityId)} · ${formatDateTime(action.at)}${failed ? ` · ${t.support.failed}` : ''}`;
  };

  return (
    <div className="card card--flush">
      <ul className="bin-list">
        {visits.map((visit) => {
          const isOpen = open === visit.id;
          return (
            <li key={visit.id} className="bin-list__row">
              {/* The words say who opened it; the hammer is only a cue. */}
              <span className="bin-list__icon" aria-hidden="true">
                <DeveloperMark size="glyph" />
              </span>
              <span className="bin-list__text">
                <strong>{t.allLogs.visit(visit.developer.name, visit.business.name)}</strong>
                <span className="table__secondary">
                  {[
                    visit.reason,
                    t.support.from(formatDateTime(visit.startedAt)),
                    t.support.lastSeen(formatDateTime(visit.lastSeenAt)),
                    t.support.changes(visit.actions.length),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {isOpen && visit.actions.length > 0 && (
                  <ul className="support-actions" id={`visit-actions-${visit.id}`}>
                    {visit.actions.map((action) => (
                      <li key={action.id} className="table__secondary">
                        {describe(action)}
                      </li>
                    ))}
                  </ul>
                )}
              </span>
              <span className="all-logs__visit-actions">
                {visit.actions.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? `visit-actions-${visit.id}` : undefined}
                    onClick={() => setOpen(isOpen ? null : visit.id)}
                  >
                    {isOpen ? t.allLogs.hideChanges : t.allLogs.showChanges}
                    <CaretDown size={12} weight="bold" aria-hidden="true" className={isOpen ? 'all-logs__caret--open' : undefined} />
                  </Button>
                )}
                <OpenBusiness business={visit.business} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
