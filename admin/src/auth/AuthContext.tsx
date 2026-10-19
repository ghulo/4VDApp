import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { authApi, meApi, permissionsApi } from '../services/api';
import { DEFAULT_PERMISSIONS, setPermissions } from './permissions';
import { setSessionExpiredHandler, tokenStore } from '../services/apiClient';
import { disablePush, reregisterPush } from '../push/browserPush';
import type { LoginResult, User } from '../services/types';
import { applyTheme } from '../theme/theme';
import { activeCatalogue, useLanguage } from '../i18n/useT';
import { AuthContext, type AuthState } from './useAuth';
import { canUseDashboard } from './roles';
import { forgetViewAs, readViewAs } from './viewAs';
import { languageAfterSignIn, takeSignInPick } from '../i18n/signInLanguage';

/** What each role may do, read before the screens draw; the usual rules if it can't be read. */
async function loadPermissions(): Promise<void> {
  setPermissions(await permissionsApi.get().catch(() => DEFAULT_PERMISSIONS));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    tokenStore.access ? { status: 'loading' } : { status: 'signedOut' },
  );
  // The language saved on the account follows the person, like the theme.
  const { setLanguage } = useLanguage();

  // Restore the session on page load if we still have a token.
  useEffect(() => {
    setSessionExpiredHandler(() => setState({ status: 'signedOut' }));
    if (!tokenStore.access) return;

    authApi
      .me()
      .then(async (user) => {
        await loadPermissions();
        setLanguage(user.language);
        setState({ status: 'signedIn', user });
      })
      .catch(() => {
        tokenStore.clear();
        setState({ status: 'signedOut' });
      });
  }, [setLanguage]);

  const signedInId = state.status === 'signedIn' ? state.user.id : null;
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
        .then((saved) => setState({ status: 'signedIn', user: saved }))
        .catch(() => undefined);
      return { ...user, language };
    },
    [setLanguage],
  );

  const login = useCallback(async (email: string, password: string) => {
    const user = await authApi.login(email, password);
    await loadPermissions();
    if (!canUseDashboard(user.role)) {
      await authApi.logout();
      throw new Error(activeCatalogue().auth.dashboardOnly);
    }
    applyTheme(user.theme);
    setState({ status: 'signedIn', user: settleLanguage(user) });
  }, [settleLanguage]);

  /**
   * Keep a session started elsewhere (invite accepted, Google sign-in). Only
   * the developer, admins, the owner and the accountant use the dashboard; for anyone else the
   * tokens are dropped and the caller sends them to the team app instead.
   */
  const adoptSession = useCallback(async (result: LoginResult): Promise<'signedIn' | 'notAdmin'> => {
    tokenStore.save(result.token, result.refreshToken);
    await loadPermissions();
    if (!canUseDashboard(result.user.role)) {
      await authApi.logout().catch(() => undefined);
      return 'notAdmin';
    }
    applyTheme(result.user.theme);
    setState({ status: 'signedIn', user: settleLanguage(result.user) });
    return 'signedIn';
  }, [settleLanguage]);

  const logout = useCallback(async () => {
    // The next person to use this browser shouldn't get the owner's alerts.
    await disablePush().catch(() => undefined);
    forgetViewAs();
    await authApi.logout().catch(() => undefined);
    setState({ status: 'signedOut' });
  }, []);

  const updateUser = useCallback((user: User) => setState({ status: 'signedIn', user }), []);

  const value = useMemo(() => {
    // The developer previewing another role: every screen draws as that role (the API answers as it too).
    const viewingAs = state.status === 'signedIn' && state.user.role === 'developer' ? readViewAs() : null;
    const shown: AuthState = viewingAs && state.status === 'signedIn' ? { status: 'signedIn', user: { ...state.user, role: viewingAs } } : state;
    return { state: shown, viewingAs, login, logout, adoptSession, updateUser };
  }, [state, login, logout, adoptSession, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
