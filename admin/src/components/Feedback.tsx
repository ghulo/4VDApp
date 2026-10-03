import { errorMessage } from '../utils/errors';
import { Button } from './ui';
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

export function Loading({ label }: { label?: string }) {
  const t = useT();
  return (
    <p className="loading" role="status">
      {label ?? t.common.loading}
    </p>
  );
}
