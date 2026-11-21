import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authApi, meApi, permissionsApi } from '../services/api';
import { currentPermissions, DEFAULT_PERMISSIONS, setPermissions } from './permissions';
import {
  answerSettles,
  currentIdentity,
  definiteRefusal,
  forgetSaved,
  holdSavedMe,
  newIdentity,
  noAnswer,
  restoreTillCopy,
  sameSignIn,
  savedMe,
  saveMe,
  setSignInUnsure,
  SWITCH_KEY,
  type SwitchStart,
  switchDone,
  switchEnded,
  switchSettled,
  switchUnsettled,
} from '../offline/savedCopy';

import { moveOldSignIn, sessionHint, setSessionExpiredHandler } from '../services/apiClient';
import { disablePush, reregisterPush } from '../push/browserPush';
import type { LoginResult, User } from '../services/types';
import { applyTheme } from '../theme/theme';
import { activeCatalogue, useLanguage } from '../i18n/useT';
import { AuthContext, type AuthState } from './useAuth';
import { canUseDashboard } from './roles';
import { followSwitches } from './businessSwitch';
import { forgetViewAs, readViewAs } from './viewAs';
import { clearBrand } from '../theme/applyBrand';
import { languageAfterSignIn, takeSignInPick } from '../i18n/signInLanguage';

/** What each role may do, read before the screens draw; the usual rules if it can't be read in time. */
async function loadPermissions(): Promise<void> {
  const late = new Promise<typeof DEFAULT_PERMISSIONS>((resolve) => window.setTimeout(resolve, ME_TIMEOUT_MS, DEFAULT_PERMISSIONS));
  setPermissions(await Promise.race([permissionsApi.get().catch(() => DEFAULT_PERMISSIONS), late]));
}

/** How long the start waits for 4VD to say who is signed in (Wi-Fi up, internet down can hang for minutes). */
const ME_TIMEOUT_MS = 8_000;
/** While started from the saved sign-in, how often 4VD is asked again. */
const RECHECK_MS = 30_000;

/** auth/me, given up on after a while (then it counts as no internet). */
function meInTime(): Promise<User> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ME_TIMEOUT_MS);
  return authApi.me(controller.signal).finally(() => window.clearTimeout(timer));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    sessionHint.signedIn ? { status: 'loading' } : { status: 'signedOut' },
  );
  // The language saved on the account follows the person, like the theme.
  const { setLanguage } = useLanguage();
  const queryClient = useQueryClient();
  // Started from the sign-in saved on this PC because 4VD couldn't be reached: asked again until it answers.
  const [fromSaved, setFromSaved] = useState(false);
  // A switch (in this tab or another) isn't settled: who is signed in here is unsure, so 4VD is asked again until it
  // says, and the till doesn't sell meanwhile.
  const [unsure, setUnsureState] = useState(() => {
    const open = switchUnsettled();
    setSignInUnsure(open);
    return open;
  });
  /** Unsure who is signed in: shown (the till doesn't sell) and known to the saved copy at once (nothing is saved). */
  const setUnsure = useCallback((value: boolean) => {
    setSignInUnsure(value);
    setUnsureState(value);
  }, []);
  /** The generation a check of the sign-in is running for (one per generation at a time). */
  const checking = useRef<number | null>(null);
  /** Who the screens show now: a check that names someone else (another person, another business) starts them from nothing. */
  const shownRef = useRef(state);
  useEffect(() => {
    shownRef.current = state;
  }, [state]);
  /** Moves on at every sign-out, sign-in and switch: a check of the sign-in still on its way from before then is ignored. */
  const generation = useRef(0);

  /**
   * Nobody is signed in here any more: what the last person's screens fetched goes (another business's customers
   * and settings must never be saved as the next person's), and checks still on their way are ignored.
   */
  const endSession = useCallback(() => {
    generation.current += 1;
    newIdentity();
    setFromSaved(false);
    setUnsure(false);
    setState({ status: 'signedOut' });
    queryClient.clear();
  }, [queryClient, setUnsure]);

  /** Ask 4VD who is signed in. No answer at all: the sign-in saved here (and the till's saved data), if there is one. */
  const restore = useCallback(
    (firstTime: boolean) => {
      const asked = generation.current;
      if (checking.current === asked) return;
      checking.current = asked;
      let askedAt = Date.now();
      moveOldSignIn()
        .then(() => {
          askedAt = Date.now();
          return meInTime();
        })
        .then(async (user) => {
          await loadPermissions();
          if (asked !== generation.current) return;
          const before = shownRef.current;
          if (before.status === 'signedIn' && !sameSignIn(before.user, user)) {
            // 4VD names someone else than the screens show (a switch whose answer was lost, then a start from the saved
            // sign-in): nothing fetched or saved for the last one may be kept or written as theirs.
            newIdentity();
            queryClient.clear();
          }
          // Asked while a switch was still on its way (here or in another tab): it may name the person being left. It is
          // shown, but nobody is saved and the till doesn't sell until an answer asked after the switch says.
          const settled = answerSettles(askedAt);
          if (settled) switchSettled();
          setLanguage(user.language);
          setFromSaved(false);
          setUnsure(!settled);
          setState({ status: 'signedIn', user });
        })
        .catch(async (error: unknown) => {
          if (asked !== generation.current) return;
          if (!noAnswer(error)) {
            // 4VD answered: the sign-in is over (or refused). Signed out, and nothing of it stays on this PC.
            sessionHint.clear();
            forgetSaved();
            endSession();
            return;
          }
          // No answer about the sign-in: the till may start from what this PC saved.
          if (!firstTime) return;
          const saved = savedMe();
          if (!saved) {
            setState({ status: 'signedOut' });
            return;
          }
          setPermissions(saved.permissions ?? DEFAULT_PERMISSIONS);
          setLanguage(saved.user.language);
          if (saved.user.businessId !== undefined) await restoreTillCopy(queryClient, { businessId: saved.user.businessId, userId: saved.user.id }, currentIdentity());
          if (asked !== generation.current) return;
          setFromSaved(true);
          setState({ status: 'signedIn', user: saved.user });
        })
        .finally(() => {
          if (checking.current === asked) checking.current = null;
        });
    },
    [setLanguage, queryClient, endSession, setUnsure],
  );

  // Restore the session on page load if we still have a token.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      forgetSaved();
      endSession();
    });
    if (!sessionHint.signedIn) return;
    restore(true);
  }, [restore, endSession]);

  /**
   * A switch is about to be sent from here: checks of the sign-in already on their way are ignored (they may answer
   * for the person being left), nothing is saved and the till doesn't sell until it is settled. Every other tab hears
   * it too (SWITCH_KEY). Answers this switch's id and whether another was unsettled already.
   */
  const beginSwitch = useCallback((): SwitchStart => {
    generation.current += 1;
    setUnsure(true);
    return holdSavedMe();
  }, [setUnsure]);

  /**
   * The switch failed. A clear no (and no earlier switch in doubt): nothing changed, the person here is saved again.
   * Anything else (no answer, a cut-off one): it may have happened, so 4VD is asked who is signed in, until it says.
   */
  const switchFailed = useCallback(
    (error: unknown, started: SwitchStart) => {
      switchEnded(started.id);
      const shown = shownRef.current;
      // Only this switch's own note goes: another one still on its way (another tab) keeps everything on hold.
      if (!started.already && definiteRefusal(error) && !switchDone(started.id)) {
        setUnsure(false);
        if (shown.status === 'signedIn' && shown.user.businessId !== undefined) saveMe(shown.user, currentPermissions());
        return;
      }
      generation.current += 1;
      restore(false);
    },
    [restore, setUnsure],
  );

  // Another tab starts a switch: checks on their way here are ignored and the till here stops selling until it is
  // settled; once it is, 4VD is asked at once who is signed in.
  useEffect(() => {
    const heard = (event: StorageEvent) => {
      if (event.key !== SWITCH_KEY) return;
      // Begun, over or settled there: what is on its way here is ignored, and 4VD is asked now (an answer settles only
      // once every switch is over). Until then nothing is saved here and the till doesn't sell.
      generation.current += 1;
      setUnsure(true);
      if (event.newValue === null || event.newValue.includes('"ended"')) restore(false);
    };
    window.addEventListener('storage', heard);
    return () => window.removeEventListener('storage', heard);
  }, [restore, setUnsure]);

  // Started without internet (or a switch isn't settled): 4VD is asked again when the connection comes back, and every half minute.
  useEffect(() => {
    if (!fromSaved && !unsure) return;
    const again = () => restore(false);
    window.addEventListener('online', again);
    const timer = window.setInterval(again, RECHECK_MS);
    return () => {
      window.removeEventListener('online', again);
      window.clearInterval(timer);
    };
  }, [fromSaved, unsure, restore]);

  // Who is signed in here, kept for a start without internet (only what 4VD itself said, never the saved copy again).
  const confirmedUser = state.status === 'signedIn' && !fromSaved ? state.user : null;
  useEffect(() => {
    if (confirmedUser?.businessId !== undefined) saveMe(confirmedUser, currentPermissions());
  }, [confirmedUser]);

  /**
   * A profile save answers with the person only: keep the business this session
   * is in and the businesses for the picker, which only auth/me knows.
   */
  const keepPlace = useCallback((user: User) => {
    setState((before) =>
      before.status === 'signedIn' && before.user.id === user.id
        ? { status: 'signedIn', user: { ...user, businessId: before.user.businessId, businesses: before.user.businesses } }
        : { status: 'signedIn', user },
    );
  }, []);

  /** Just signed in: the sign-in answer doesn't name the businesses, so ask once for the picker. */
  const loadPlace = useCallback(() => {
    authApi
      .me()
      .then((me) =>
        setState((before) =>
          before.status === 'signedIn' && before.user.id === me.id
            ? { status: 'signedIn', user: { ...before.user, businessId: me.businessId, businesses: me.businesses } }
            : before,
        ),
      )
      .catch(() => undefined);
  }, []);

  const signedInId = state.status === 'signedIn' ? state.user.id : null;
  // Another tab picked another business: this one must not keep working in the old one.
  useEffect(() => (signedInId === null ? undefined : followSwitches()), [signedInId]);
  useEffect(() => {
    if (signedInId !== null) reregisterPush().catch(() => undefined);
  }, [signedInId]);

  /**
   * Just signed in: the account's language applies, unless one was picked on
   * the sign-in screen, which wins and is saved to the account.
   */
  const settleLanguage = useCallback(
    (user: User): User => {
      const { language, saveToAccount } = languageAfterSignIn(user.language, takeSignInPick());
      setLanguage(language);
      if (!saveToAccount) return user;
      meApi
        .updateProfile({ language })
        .then(keepPlace)
        .catch(() => undefined);
      return { ...user, language };
    },
    [setLanguage, keepPlace],
  );

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    if ('challenge' in result || 'setupChallenge' in result) return result;
    const user = result;
    await loadPermissions();
    if (!canUseDashboard(user.role)) {
      await authApi.logout();
      throw new Error(activeCatalogue().auth.dashboardOnly);
    }
    applyTheme(user.theme);
    // A new person here: nothing fetched before belongs to them.
    // Checks of the sign-in still on their way from before name the last person: ignored.
    generation.current += 1;
    setFromSaved(false);
    setUnsure(false);
    newIdentity();
    queryClient.clear();
    switchSettled();
    setState({ status: 'signedIn', user: settleLanguage(user) });
    loadPlace();
    return null;
  }, [settleLanguage, loadPlace, queryClient, setUnsure]);

  /**
   * Keep a session started elsewhere (invite accepted, Google sign-in). Only
   * the developer, admins, the owner and the accountant use the dashboard; for anyone else the
   * tokens are dropped and the caller sends them to the team app instead.
   */
  const adoptSession = useCallback(async (result: LoginResult, place?: Pick<User, 'businessId' | 'businesses'>, switched?: SwitchStart): Promise<'signedIn' | 'notAdmin'> => {
    sessionHint.set();
    await loadPermissions();
    if (!canUseDashboard(result.user.role)) {
      await authApi.logout().catch(() => undefined);
      return 'notAdmin';
    }
    applyTheme(result.user.theme);
    // A new person here. The Counter handing over keeps its business (`place`): its data stays, only the person changes,
    // and the new person is saved for a start without internet at once. Anyone else starts from nothing.
    // Checks of the sign-in still on their way from before name the last person: ignored.
    generation.current += 1;
    setFromSaved(false);
    // A switch made here (a takeover at the Counter) ends only its own note: another still on its way (another tab)
    // keeps everything on hold until 4VD, asked after it is over, names who is signed in.
    const stillOpen = switched ? switchDone(switched.id) : (switchSettled(), false);
    setUnsure(stillOpen);
    newIdentity();
    if (!place) queryClient.clear();
    setState({ status: 'signedIn', user: settleLanguage(place ? { ...result.user, ...place } : result.user) });
    loadPlace();
    if (stillOpen) restore(false);
    return 'signedIn';
  }, [settleLanguage, loadPlace, queryClient, setUnsure, restore]);

  const logout = useCallback(async () => {
    // The next person to use this browser shouldn't get the owner's alerts.
    await disablePush().catch(() => undefined);
    forgetViewAs();
    // The next person signs in to their own business: back to 4VD's look until then.
    clearBrand();
    // The next person to use this PC can't start the till as this one without internet.
    forgetSaved();
    await authApi.logout().catch(() => undefined);
    endSession();
  }, [endSession]);

  const updateUser = keepPlace;

  const value = useMemo(() => {
    // The developer previewing another role: every screen draws as that role (the API answers as it too).
    const viewingAs = state.status === 'signedIn' && (state.user.role === 'developer' || state.user.role === 'main_admin') ? readViewAs() : null;
    const shown: AuthState = viewingAs && state.status === 'signedIn' ? { status: 'signedIn', user: { ...state.user, role: viewingAs } } : state;
    return { state: shown, viewingAs, login, logout, adoptSession, updateUser, signInUnsure: unsure, beginSwitch, switchFailed };
  }, [state, login, logout, adoptSession, updateUser, unsure, beginSwitch, switchFailed]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
