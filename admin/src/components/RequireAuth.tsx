import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { counterOnly } from '../auth/roles';
import { LogoMark } from './LogoMark';
import { useT } from '../i18n/useT';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  const t = useT();

  if (state.status === 'loading') {
    return (
      <div className="splash" role="status">
        <LogoMark size={40} />
        <span>{t.common.restoringSession}</span>
      </div>
    );
  }
  if (state.status === 'signedOut') {
    // Remember where they were going so login can send them back.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  // Employees use the dashboard for the Counter only.
  if (counterOnly(state.user.role) && !/^\/counter(\/|$)/.test(location.pathname)) {
    return <Navigate to="/counter" replace />;
  }
  return children;
}
