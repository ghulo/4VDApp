import { useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient';

type ConnectionState =
  | { kind: 'checking' }
  | { kind: 'online'; checkedAt: string }
  | { kind: 'offline'; reason: string };

export function ApiStatus() {
  const [connection, setConnection] = useState<ConnectionState>({ kind: 'checking' });

  useEffect(() => {
    let isCancelled = false;

    apiClient
      .getHealth()
      .then((health) => {
        if (!isCancelled) setConnection({ kind: 'online', checkedAt: health.timestamp });
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : 'Unknown error';
        if (!isCancelled) setConnection({ kind: 'offline', reason });
      });

    // Avoid setting state if the component unmounts before the request ends.
    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <div className={`api-status api-status--${connection.kind}`} role="status">
      <span className="api-status__dot" aria-hidden="true" />
      {connection.kind === 'checking' && 'Checking API connection…'}
      {connection.kind === 'online' && 'API online'}
      {connection.kind === 'offline' && `API unreachable: ${connection.reason}`}
    </div>
  );
}
