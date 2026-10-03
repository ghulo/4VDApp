import { Checks } from '@phosphor-icons/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { Button, PageHeader } from '../components/ui';
import { notificationsApi } from '../services/api';
import { formatDateTime } from '../utils/format';
import { useT } from '../i18n/useT';

export function AlertsPage() {
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

  return (
    <>
      <PageHeader
        title={t.alerts.title}
        description={t.alerts.description}
        actions={
          alerts.data &&
          alerts.data.unreadCount > 0 && (
            <Button icon={Checks} onClick={() => markAllRead.mutate()}>
              {t.alerts.markAllRead}
            </Button>
          )
        }
      />

      {alerts.isPending && <Loading />}
      {alerts.isError && <ErrorNotice error={alerts.error} onRetry={() => alerts.refetch()} />}
      {alerts.data && alerts.data.items.length === 0 && (
        <EmptyState art title={t.alerts.none}>
          {t.alerts.noneHint}
        </EmptyState>
      )}
      {alerts.data && alerts.data.items.length > 0 && (
        <>
          <ul className="category-list">
            {alerts.data.items.map((alert) => (
              <li key={alert.id} className={`category-list__row alert-row${alert.isRead ? '' : ' alert-row--unread'}`}>
                <div>
                  <p className="category-list__name">
                    <span className={`alert-row__dot alert-row__dot--${alert.type ?? 'info'}`} aria-hidden="true" />
                    {alert.title}
                  </p>
                  <p className="category-list__description">{alert.message}</p>
                </div>
                <span className="category-list__count">{formatDateTime(alert.createdAt)}</span>
                <span className="category-list__actions">
                  {!alert.isRead && (
                    <Button size="sm" onClick={() => markRead.mutate(alert.id)}>
                      {t.alerts.markRead}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <Pagination meta={alerts.data.meta} itemLabel={t.alerts.items} onPageChange={setPage} />
        </>
      )}
    </>
  );
}
