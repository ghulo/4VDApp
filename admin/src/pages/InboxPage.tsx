import { Checks } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { PendingDecisions } from '../components/PendingDecisions';
import { Button, EmptyState, PageHeader } from '../components/ui';
import { useT } from '../i18n/useT';
import { notificationsApi } from '../services/api';
import { formatDateTime } from '../utils/format';

/** Where an alert without its own link should take you. */
const PAGE_BY_TYPE: Record<string, string> = {
  low_stock: '/inventory?lowStock=true',
  out_of_stock: '/inventory?lowStock=true',
  cash_difference: '/cash',
  daily_summary: '/report',
};

/** One place to look: what waits for a decision first, then everything the shop told you. */
export function InboxPage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t.inbox.title} description={t.inbox.description} />
      <section aria-labelledby="inbox-decisions" className="inbox__section">
        <h2 id="inbox-decisions" className="inbox__heading">
          {t.inbox.decisions}
        </h2>
        <PendingDecisions />
      </section>
      <section aria-labelledby="inbox-alerts" className="inbox__section">
        <h2 id="inbox-alerts" className="inbox__heading">
          {t.inbox.alerts}
        </h2>
        <AlertList />
      </section>
    </>
  );
}

function AlertList() {
  const t = useT();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const alerts = useQuery({
    queryKey: ['notifications', { page }],
    queryFn: () => notificationsApi.list(page),
    placeholderData: keepPreviousData,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({ mutationFn: notificationsApi.markRead, onSuccess: refresh });
  const markAllRead = useMutation({ mutationFn: notificationsApi.markAllRead, onSuccess: refresh });

  if (alerts.isPending) return <Loading />;
  if (alerts.isError) return <ErrorNotice error={alerts.error} onRetry={() => alerts.refetch()} />;
  if (alerts.data.items.length === 0) {
    return (
      <EmptyState title={t.alerts.none}>
        {t.alerts.noneHint}
      </EmptyState>
    );
  }

  return (
    <>
      <div className="toolbar inbox__toolbar">
        <span className="inbox__count">{alerts.data.unreadCount > 0 ? t.inbox.unread(alerts.data.unreadCount) : t.inbox.allRead}</span>
        {alerts.data.unreadCount > 0 && (
          <Button size="sm" icon={Checks} disabled={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
            {t.alerts.markAllRead}
          </Button>
        )}
      </div>
      <ul className="category-list alert-list">
        {alerts.data.items.map((alert) => {
          const link = alert.link ?? (alert.type ? PAGE_BY_TYPE[alert.type] : undefined);
          return (
          <li key={alert.id} className={`category-list__row alert-row${alert.isRead ? '' : ' alert-row--unread'}`}>
            <div>
              <p className="category-list__name">
                <span className={`alert-row__dot alert-row__dot--${alert.type ?? 'info'}`} aria-hidden="true" />
                {link ? (
                  <Link to={link} onClick={() => !alert.isRead && markRead.mutate(alert.id)}>
                    {alert.title}
                  </Link>
                ) : (
                  alert.title
                )}
              </p>
              <p className="category-list__description">{alert.message}</p>
            </div>
            <span className="category-list__count">{formatDateTime(alert.createdAt)}</span>
            <span className="category-list__actions">
              {!alert.isRead && (
                <Button size="sm" variant="ghost" onClick={() => markRead.mutate(alert.id)}>
                  {t.alerts.markRead}
                </Button>
              )}
            </span>
          </li>
          );
        })}
      </ul>
      <Pagination meta={alerts.data.meta} itemLabel={t.alerts.items} onPageChange={setPage} />
    </>
  );
}
