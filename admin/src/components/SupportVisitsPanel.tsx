import { Hammer } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../i18n/useT';
import { supportApi, type SupportAction } from '../services/api';
import { formatDateTime } from '../utils/format';
import { ErrorNotice, Loading } from './Feedback';
import { Card, DeveloperMark, EmptyState } from './ui';

/**
 * Settings → Support visits: every time someone from 4VD opened this business,
 * and each change they made while in it. Kept by the database; nobody can
 * remove a visit, 4VD included.
 */
export function SupportVisitsPanel() {
  const t = useT();
  const visits = useQuery({ queryKey: ['support-visits'], queryFn: supportApi.visits });

  if (visits.isPending) return <Loading />;
  if (visits.isError) return <ErrorNotice error={visits.error} onRetry={() => visits.refetch()} />;

  const describe = (action: SupportAction) => {
    const failed = action.status !== null && action.status >= 400;
    return `${t.support.action(action.method, action.entity, action.entityId)} · ${formatDateTime(action.at)}${failed ? ` · ${t.support.failed}` : ''}`;
  };

  return (
    <Card title={t.support.title} description={t.support.description} flush={visits.data.length > 0}>
      {visits.data.length === 0 ? (
        <EmptyState icon={Hammer} title={t.support.empty}>
          {t.support.emptyHint}
        </EmptyState>
      ) : (
        <ul className="bin-list">
          {visits.data.map((visit) => (
            <li key={visit.id} className="bin-list__row">
              {/* The row text already says who opened it; the hammer is only a cue. */}
              <span className="bin-list__icon" aria-hidden="true">
                <DeveloperMark size="glyph" />
              </span>
              <span className="bin-list__text">
                <strong>{t.support.opened(visit.developerName)}</strong>
                <span className="table__secondary">
                  {[t.support.from(formatDateTime(visit.startedAt)), t.support.lastSeen(formatDateTime(visit.lastSeenAt)), t.support.changes(visit.actions.length)].join(' · ')}
                </span>
                {visit.actions.length > 0 && (
                  <ul className="support-actions">
                    {visit.actions.map((action, index) => (
                      <li key={index} className="table__secondary">
                        {describe(action)}
                      </li>
                    ))}
                  </ul>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
