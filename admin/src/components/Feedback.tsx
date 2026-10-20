import { errorMessage } from '../utils/errors';
import { Button, Skeleton } from './ui';
import { useT } from '../i18n/useT';

export { EmptyState } from './ui';

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="notice notice--error" role="alert">
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {t.common.tryAgain}
        </Button>
      )}
    </div>
  );
}

/** Grey lines in the shape of text while a part loads; with a label ("Restoring your session…"), those words instead. */
export function Loading({ label }: { label?: string }) {
  if (!label) return <Skeleton />;
  return (
    <p className="loading" role="status">
      {label}
    </p>
  );
}
