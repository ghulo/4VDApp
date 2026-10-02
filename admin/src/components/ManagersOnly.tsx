import type { ReactNode } from 'react';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';

/**
 * Controls that change the shop's setup. The owner sees them, greyed out with a
 * short note, so the page still reads the same; the API refuses the change anyway.
 */
export function ManagersOnly({ children, note }: { children: ReactNode; note?: string }) {
  const { role } = useCurrentUser();
  if (canManage(role)) return children;
  return (
    <fieldset disabled className="read-only">
      {note && <p className="read-only__note">{note}</p>}
      {children}
    </fieldset>
  );
}
