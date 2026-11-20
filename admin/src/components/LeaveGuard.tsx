import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import { useT } from '../i18n/useT';
import { holdsBack, type Guard } from '../utils/leaveGuard';
import { Button, Sheet } from './ui';
import { type LeaveGuardApi, LeaveGuardContext } from './ui/leaveGuardContext';

/**
 * The app's one "Leave without saving?" question. Forms with typed work
 * register here (useWarnBeforeLeaving for long pages, every card Sheet by
 * itself); a move that would lose their work is held back until answered.
 * One router blocker for all of them: React Router honours only one at a time.
 */
export function LeaveGuardHost({ children }: { children: ReactNode }) {
  const t = useT();
  const guards = useRef(new Set<Guard>());
  const blocker = useBlocker(({ currentLocation, nextLocation, historyAction }) =>
    holdsBack(guards.current, { currentPath: currentLocation.pathname, nextPath: nextLocation.pathname, action: historyAction }),
  );
  // A card asking before it closes (Esc, a tap outside, its close key, pulled down).
  const [asking, setAsking] = useState<((leave: boolean) => void) | null>(null);
  const api = useMemo<LeaveGuardApi>(
    () => ({
      register: (guard) => {
        guards.current.add(guard);
        return () => void guards.current.delete(guard);
      },
      ask: () => new Promise<boolean>((resolve) => setAsking(() => resolve)),
    }),
    [],
  );

  // The form went away while its move was held (signed out, another tab of the same page): nothing left to lose.
  useEffect(() => {
    if (blocker.state === 'blocked' && ![...guards.current].some((guard) => guard.active())) blocker.proceed();
  }, [blocker]);

  const answer = (leave: boolean) => {
    if (blocker.state === 'blocked') {
      if (leave) blocker.proceed();
      else blocker.reset();
    }
    asking?.(leave);
    setAsking(null);
  };

  return (
    <LeaveGuardContext.Provider value={api}>
      {children}
      <Sheet open={blocker.state === 'blocked' || asking !== null} onClose={() => answer(false)} title={t.common.leaveTitle} description={t.common.leaveDetail} placement="center">
        <div className="form-actions">
          {/* The safe answer first and focused: Enter or Esc keeps the work. */}
          <Button variant="primary" data-autofocus onClick={() => answer(false)}>
            {t.common.keepEditing}
          </Button>
          <Button variant="danger-text" onClick={() => answer(true)}>
            {t.common.leave}
          </Button>
        </div>
      </Sheet>
    </LeaveGuardContext.Provider>
  );
}
