import { useEffect, useRef } from 'react';
import { errorMessage } from '../utils/errors';
import { Button, Skeleton, useToast } from './ui';
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

/**
 * "Saved" and other news after an action, as a toast in the corner: shown
 * once each time this mounts, so put it where the old "Saved" words were.
 */
export function SavedToast({ message }: { message: string }) {
  const toast = useToast();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast({ title: message });
  }, [toast, message]);
  return null;
}
