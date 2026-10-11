import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { canOversee } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { activityApi } from '../services/api';
import type { ActivityEntry, HistoryEntity } from '../services/types';
import { formatDateTime } from '../utils/format';
import { ErrorNotice, Loading } from './Feedback';
import { Badge, Button, Card } from './ui';

/** Newest few first; the rest behind "Show all", so a long-lived product doesn't push the page down. */
const SHOWN = 8;

/** Field changes some entries carry ({ field, from, to }), shown under the sentence. */
function fieldChanges(entry: ActivityEntry): Array<{ field: string; from: unknown; to: unknown }> {
  const fields = entry.details?.fields;
  return Array.isArray(fields) ? fields.filter((change) => change && typeof change === 'object' && 'field' in change) : [];
}

/**
 * Everything that happened to one record, read from the activity log: who did
 * what and when, undos included. People who run the shop see it; the log can't
 * be edited.
 */
export function HistoryCard({ entityType, entityId }: { entityType: HistoryEntity; entityId: number }) {
  const t = useT();
  const { role } = useCurrentUser();
  const allowed = canOversee(role);
  const [all, setAll] = useState(false);
  const history = useQuery({
    queryKey: ['activity', 'history', entityType, entityId],
    queryFn: () => activityApi.history(entityType, entityId),
    enabled: allowed,
  });
  if (!allowed) return null;

  const entries = [...(history.data ?? [])].reverse();
  const shown = all ? entries : entries.slice(0, SHOWN);
  const value = (raw: unknown) => (raw === null || raw === undefined || raw === '' ? t.history.nothing : String(raw));

  return (
    <Card title={t.history.title} description={t.history.description} className="record-history-card">
      {history.isPending ? (
        <Loading />
      ) : history.isError ? (
        <ErrorNotice error={history.error} onRetry={() => history.refetch()} />
      ) : entries.length === 0 ? (
        <p className="field-hint">{t.history.empty}</p>
      ) : (
        <>
          <ol className="record-history">
            {shown.map((entry) => (
              <li key={entry.id} className={entry.undo?.state === 'undone' ? 'record-history__entry is-undone' : 'record-history__entry'}>
                <span className="record-history__when">
                  <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                  {entry.user && <span> · {t.history.by(entry.user.name)}</span>}
                </span>
                <span className="record-history__what">
                  <span className="record-history__text">{entry.summary}</span>
                  {entry.undo?.state === 'undone' && <Badge tone="neutral">{t.history.undone}</Badge>}
                </span>
                {fieldChanges(entry).map((change) => (
                  <span key={change.field} className="record-history__change">
                    {t.history.change({ field: change.field, from: value(change.from), to: value(change.to) })}
                  </span>
                ))}
              </li>
            ))}
          </ol>
          {entries.length > SHOWN && (
            <Button size="sm" variant="ghost" onClick={() => setAll((current) => !current)}>
              {all ? t.history.showFewer : t.history.showAll(entries.length)}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
