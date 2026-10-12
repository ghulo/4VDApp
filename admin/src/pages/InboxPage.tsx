import { Bell, ChartBar, Checks, type Icon, Money, Package, Tray } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { PendingDecisions } from '../components/PendingDecisions';
import { TodoGroups } from '../components/TodoList';
import { Button, ButtonLink, EmptyState, PageHeader, ShopSunrise, StatGrid, StatTile } from '../components/ui';
import { useT } from '../i18n/useT';
import { notificationsApi } from '../services/api';
import type { AppNotification, TodoSeverity } from '../services/types';
import { dayHeading, formatTime, groupByDay } from '../utils/format';
import { useAttention } from '../utils/useAttention';

/** Where an alert without its own link should take you. */
const PAGE_BY_TYPE: Record<string, string> = {
  low_stock: '/inventory?status=low',
  out_of_stock: '/inventory?status=out',
  cash_difference: '/cash',
  daily_summary: '/report',
};

/**
 * To do (DESIGN.md 3.3): requests to decide first, then everything else the
 * shop needs from you, split by how pressing it is. Worked out from the shop
 * as it is now, so items leave by themselves once they are dealt with.
 */
export function InboxPage() {
  const t = useT();
  const attention = useAttention();
  const todo = attention.data?.todo ?? [];
  const others = todo.filter((item) => item.kind !== 'requests');
  const hasRequests = todo.some((item) => item.kind === 'requests');
  const count = (severity: TodoSeverity) => others.filter((item) => item.severity === severity).length;

  return (
    <>
      <PageHeader title={t.inbox.title} description={t.inbox.description} />
      {attention.isPending && <Loading />}
      {attention.isError && <ErrorNotice error={attention.error} onRetry={() => attention.refetch()} />}
      {attention.data && todo.length === 0 && <AllClear />}
      {todo.length > 0 && (
        <StatGrid>
          <StatTile label={t.inbox.summary.urgent} value={count('urgent')} tone={count('urgent') > 0 ? 'danger' : 'default'} />
          <StatTile label={t.inbox.summary.check} value={count('check')} tone={count('check') > 0 ? 'warn' : 'default'} />
          <StatTile
            label={t.inbox.summary.decide}
            value={hasRequests ? t.inbox.summary.waiting : t.inbox.summary.none}
            hint={t.inbox.summary.decideHint}
          />
          <StatTile label={t.inbox.summary.ideas} value={count('idea')} hint={t.inbox.summary.ideasHint} />
        </StatGrid>
      )}
      {hasRequests && (
        <section aria-labelledby="inbox-decisions" className="inbox__section">
          <h2 id="inbox-decisions" className="inbox__heading">
            {t.inbox.decisions}
          </h2>
          <PendingDecisions />
        </section>
      )}
      <TodoGroups items={others} idPrefix="inbox" />
    </>
  );
}

/** Nothing waiting: the shop at sunrise, and where to look instead. */
function AllClear() {
  const t = useT();
  return (
    <div className="inbox-clear">
      <div className="inbox-clear__art" aria-hidden="true">
        <ShopSunrise />
      </div>
      <h2 className="inbox-clear__title">{t.todo.none}</h2>
      <p className="inbox-clear__hint">{t.todo.noneHint}</p>
      <ButtonLink to="/inbox/updates" variant="secondary">
        {t.inbox.seeUpdates}
      </ButtonLink>
    </div>
  );
}

type AlertFilter = 'all' | 'reports' | 'requests' | 'stock' | 'cash';

/** Kinds of alert to filter by, mapped to the types the server stores. */
const ALERT_FILTERS: Array<{ key: AlertFilter; types?: string; icon: Icon }> = [
  { key: 'all', icon: Bell },
  { key: 'reports', types: 'daily_report,weekly_report,daily_summary,day_closed', icon: ChartBar },
  { key: 'requests', types: 'approval,approval_decision,bill_scan', icon: Tray },
  { key: 'stock', types: 'low_stock,out_of_stock,expiring', icon: Package },
  { key: 'cash', types: 'cash_difference', icon: Money },
];

const iconFor = (type: string | null): Icon =>
  ALERT_FILTERS.find((filter) => filter.types?.split(',').includes(type ?? ''))?.icon ?? Bell;

/** Updates: things that happened, for information only. They never count toward a badge. */
export function UpdatesPage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t.inbox.title} description={t.inbox.updatesDescription} />
      <AlertList />
    </>
  );
}

function AlertList() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<AlertFilter>('all');
  const types = ALERT_FILTERS.find((option) => option.key === filter)?.types;
  const alerts = useQuery({
    queryKey: ['notifications', { page, types }],
    queryFn: () => notificationsApi.list(page, false, types),
    placeholderData: keepPreviousData,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({ mutationFn: notificationsApi.markRead, onSuccess: refresh });
  const markAllRead = useMutation({ mutationFn: notificationsApi.markAllRead, onSuccess: refresh });

  // Opening an alert reads it.
  function open(alert: AppNotification, link: string) {
    if (!alert.isRead) markRead.mutate(alert.id);
    navigate(link);
  }

  return (
    <>
      <div className="toolbar inbox__toolbar">
        <div className="segmented segmented--small" role="radiogroup" aria-label={t.inbox.show}>
          {ALERT_FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={filter === option.key}
              className="segmented__option"
              onClick={() => {
                setFilter(option.key);
                setPage(1);
              }}
            >
              {t.inbox.filters[option.key]}
            </button>
          ))}
        </div>
        <span className="inbox__toolbar-end">
          {alerts.data && (
            <span className="inbox__count">{alerts.data.unreadCount > 0 ? t.inbox.unread(alerts.data.unreadCount) : t.inbox.allRead}</span>
          )}
          {alerts.data && alerts.data.unreadCount > 0 && (
            <Button size="sm" icon={Checks} disabled={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
              {t.alerts.markAllRead}
            </Button>
          )}
        </span>
      </div>
      {alerts.isPending && <Loading />}
      {alerts.isError && <ErrorNotice error={alerts.error} onRetry={() => alerts.refetch()} />}
      {alerts.data && alerts.data.items.length === 0 && (
        <EmptyState icon={Bell} title={filter === 'all' ? t.alerts.none : t.inbox.noneOfKind}>
          {filter === 'all' ? t.alerts.noneHint : t.inbox.noneOfKindHint}
        </EmptyState>
      )}
      {alerts.data &&
        groupByDay(alerts.data.items, (alert) => alert.createdAt).map((group) => (
          <section key={group.day} className="day-group" aria-labelledby={`alerts-${group.day}`}>
            <h2 id={`alerts-${group.day}`} className="day-group__heading">
              {dayHeading(group.day, t.periods.options)}
            </h2>
            <ul className="alert-feed">
              {group.rows.map((alert) => {
                const link = alert.link ?? (alert.type ? PAGE_BY_TYPE[alert.type] : undefined);
                const AlertIcon = iconFor(alert.type);
                const unread = !alert.isRead && <span className="visually-hidden">{t.inbox.unreadLabel}: </span>;
                return (
                  <li key={alert.id} className={`alert-feed__row${alert.isRead ? '' : ' alert-feed__row--unread'}`}>
                    <span className={`alert-feed__icon alert-feed__icon--${alert.type ?? 'info'}`} aria-hidden="true">
                      <AlertIcon size={18} />
                    </span>
                    <span className="alert-feed__text">
                      {link ? (
                        <button type="button" className="alert-feed__title alert-feed__open" onClick={() => open(alert, link)}>
                          {unread}
                          {alert.title}
                        </button>
                      ) : (
                        <span className="alert-feed__title">
                          {unread}
                          {alert.title}
                        </span>
                      )}
                      <span className="alert-feed__message">{alert.message}</span>
                    </span>
                    <time className="alert-feed__time" dateTime={alert.createdAt}>
                      {formatTime(alert.createdAt)}
                    </time>
                    <span className="alert-feed__actions">
                      {!alert.isRead && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Checks}
                          aria-label={`${t.alerts.markRead}: ${alert.title}`}
                          disabled={markRead.isPending}
                          onClick={() => markRead.mutate(alert.id)}
                        />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      {alerts.data && alerts.data.items.length > 0 && (
        <Pagination meta={alerts.data.meta} itemLabel={t.alerts.items} onPageChange={setPage} />
      )}
    </>
  );
}
