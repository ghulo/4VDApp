import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { Loading } from './Feedback';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <Loading label="Restoring your session…" />;
  if (state.status === 'signedOut') {
    // Remember where they were going so login can send them back.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}
