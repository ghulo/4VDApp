import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authApi, meApi, permissionsApi } from '../services/api';
import { currentPermissions, DEFAULT_PERMISSIONS, setPermissions } from './permissions';
import { forgetSaved, restoreTillCopy, savedMe, saveMe } from '../offline/savedCopy';

import { ApiError, moveOldSignIn, sessionHint, setSessionExpiredHandler } from '../services/apiClient';
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

/** What each role may do, read before the screens draw; the usual rules if it can't be read. */
async function loadPermissions(): Promise<void> {
  setPermissions(await permissionsApi.get().catch(() => DEFAULT_PERMISSIONS));
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
  const checking = useRef(false);

  /** Ask 4VD who is signed in. No answer at all: the sign-in saved here (and the till's saved data), if there is one. */
  const restore = useCallback(
    (firstTime: boolean) => {
      if (checking.current) return;
      checking.current = true;
      moveOldSignIn()
        .then(() => meInTime())
        .then(async (user) => {
          await loadPermissions();
          setLanguage(user.language);
          setFromSaved(false);
          setState({ status: 'signedIn', user });
        })
        .catch(async (error: unknown) => {
          if (error instanceof ApiError && error.status === 401) {
            // 4VD said the sign-in is over: signed out, and nothing of it stays on this PC.
            sessionHint.clear();
            forgetSaved();
            setFromSaved(false);
            setState({ status: 'signedOut' });
            return;
          }
          // Any other trouble (no internet, a timeout, a busy or broken server): no answer about the sign-in.
          if (!firstTime) return;
          const saved = savedMe();
          if (!saved) {
            setState({ status: 'signedOut' });
            return;
          }
          setPermissions(saved.permissions ?? DEFAULT_PERMISSIONS);
          setLanguage(saved.user.language);
          if (saved.user.businessId !== undefined) await restoreTillCopy(queryClient, { businessId: saved.user.businessId, userId: saved.user.id });
          setFromSaved(true);
          setState({ status: 'signedIn', user: saved.user });
        })
        .finally(() => {
          checking.current = false;
        });
    },
    [setLanguage, queryClient],
  );

  // Restore the session on page load if we still have a token.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      forgetSaved();
      setState({ status: 'signedOut' });
    });
    if (!sessionHint.signedIn) return;
    restore(true);
  }, [restore]);

  // Started without internet: 4VD is asked again when the connection comes back, and every half minute.
  useEffect(() => {
    if (!fromSaved) return;
    const again = () => restore(false);
    window.addEventListener('online', again);
    const timer = window.setInterval(again, RECHECK_MS);
    return () => {
      window.removeEventListener('online', again);
      window.clearInterval(timer);
    };
  }, [fromSaved, restore]);

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
    setState({ status: 'signedIn', user: settleLanguage(user) });
    loadPlace();
    return null;
  }, [settleLanguage, loadPlace]);

  /**
   * Keep a session started elsewhere (invite accepted, Google sign-in). Only
   * the developer, admins, the owner and the accountant use the dashboard; for anyone else the
   * tokens are dropped and the caller sends them to the team app instead.
   */
  const adoptSession = useCallback(async (result: LoginResult): Promise<'signedIn' | 'notAdmin'> => {
    sessionHint.set();
    await loadPermissions();
    if (!canUseDashboard(result.user.role)) {
      await authApi.logout().catch(() => undefined);
      return 'notAdmin';
    }
    applyTheme(result.user.theme);
    setState({ status: 'signedIn', user: settleLanguage(result.user) });
    loadPlace();
    return 'signedIn';
  }, [settleLanguage, loadPlace]);

  const logout = useCallback(async () => {
    // The next person to use this browser shouldn't get the owner's alerts.
    await disablePush().catch(() => undefined);
    forgetViewAs();
    // The next person signs in to their own business: back to 4VD's look until then.
    clearBrand();
    // The next person to use this PC can't start the till as this one without internet.
    forgetSaved();
    await authApi.logout().catch(() => undefined);
    setState({ status: 'signedOut' });
  }, []);

  const updateUser = keepPlace;

  const value = useMemo(() => {
    // The developer previewing another role: every screen draws as that role (the API answers as it too).
    const viewingAs = state.status === 'signedIn' && (state.user.role === 'developer' || state.user.role === 'main_admin') ? readViewAs() : null;
    const shown: AuthState = viewingAs && state.status === 'signedIn' ? { status: 'signedIn', user: { ...state.user, role: viewingAs } } : state;
    return { state: shown, viewingAs, login, logout, adoptSession, updateUser };
  }, [state, login, logout, adoptSession, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
