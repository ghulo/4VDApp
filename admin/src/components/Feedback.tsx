import type { ReactNode } from 'react';
import { errorMessage } from '../utils/errors';

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="notice notice--error" role="alert">
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <button type="button" className="button button--quiet" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="loading" role="status">
      {label}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {children}
    </div>
  );
}
