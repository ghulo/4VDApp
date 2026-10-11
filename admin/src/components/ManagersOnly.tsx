import type { ReactNode } from 'react';
import { canManage } from '../auth/roles';
import type { UserRole } from '../services/types';
import { useCurrentUser } from '../auth/useAuth';

/**
 * Controls that change the shop's setup. The owner sees them, greyed out with a
 * short note, so the page still reads the same; the API refuses the change anyway.
 */
export function ManagersOnly({ children, note, can = canManage }: { children: ReactNode; note?: string; can?: (role: UserRole) => boolean }) {
  const { role } = useCurrentUser();
  if (can(role)) return children;
  return (
    <fieldset disabled className="read-only">
      {note && <p className="read-only__note">{note}</p>}
      {children}
    </fieldset>
  );
}
