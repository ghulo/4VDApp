import { createContext, useContext, useEffect, useRef } from 'react';
import { type Guard, type GuardKind, promptsOnUnload } from '../../utils/leaveGuard';

export interface LeaveGuardApi {
  /** Holds back moves that would lose this guard's typed work; gives back the way to let go. */
  register: (guard: Guard) => () => void;
  /** Asks "Leave without saving?"; true when the answer is Leave. */
  ask: () => Promise<boolean>;
}

/** Outside the app's router (tests, the kit's snapshots) nothing is held back and nothing is asked. */
export const LeaveGuardContext = createContext<LeaveGuardApi>({
  register: () => () => undefined,
  ask: () => Promise.resolve(true),
});

/**
 * Inside a card form: tells the card that something was typed or picked,
 * for a control that changes the form without a text box (a list pick, a
 * chip). Typing in an input, select or textarea is noticed by itself.
 */
export const SheetWorkContext = createContext<() => void>(() => undefined);
export const useMarkTyped = () => useContext(SheetWorkContext);

/** Keeps `kind` guard registered while mounted; `active` is read at the moment of each move. */
export function useLeaveGuard(kind: GuardKind, active: boolean) {
  const { register } = useContext(LeaveGuardContext);
  const live = useRef(active);
  useEffect(() => {
    live.current = active;
  });
  useEffect(() => register({ kind, active: () => live.current }), [register, kind]);
}

/**
 * While `active`, typed work isn't lost by leaving: another page of the
 * dashboard (a menu link, Back) asks first, and so does closing or reloading
 * the tab. Not in the Windows app, which would silently refuse to close.
 * Leave `active` false while saving and once saved (`!save.isPending &&
 * !save.isSuccess`), so moving on to the saved record isn't asked about.
 */
export function useWarnBeforeLeaving(active: boolean) {
  useLeaveGuard('page', active);
  useEffect(() => {
    if (!active || !promptsOnUnload()) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}
