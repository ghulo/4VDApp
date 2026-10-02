import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { authApi } from '../services/api';
import { setSessionExpiredHandler, tokenStore } from '../services/apiClient';
import { disablePush } from '../push/browserPush';
import type { LoginResult, User } from '../services/types';
import { applyTheme } from '../theme/theme';
import { AuthContext, type AuthState } from './useAuth';
import { canOversee } from './roles';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    tokenStore.access ? { status: 'loading' } : { status: 'signedOut' },
  );

  // Restore the session on page load if we still have a token.
  useEffect(() => {
    setSessionExpiredHandler(() => setState({ status: 'signedOut' }));
    if (!tokenStore.access) return;

    authApi
      .me()
      .then((user) => setState({ status: 'signedIn', user }))
      .catch(() => {
        tokenStore.clear();
        setState({ status: 'signedOut' });
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const user = await authApi.login(email, password);
    if (!canOversee(user.role)) {
      await authApi.logout();
      throw new Error('This dashboard is for the people who run the shop. Use the team app to sell and browse products.');
    }
    applyTheme(user.theme);
    setState({ status: 'signedIn', user });
  }, []);

  /**
   * Keep a session started elsewhere (invite accepted, Google sign-in). Only
   * the developer, admins and the owner use the dashboard; for anyone else the
   * tokens are dropped and the caller sends them to the team app instead.
   */
  const adoptSession = useCallback(async (result: LoginResult): Promise<'signedIn' | 'notAdmin'> => {
    tokenStore.save(result.token, result.refreshToken);
    if (!canOversee(result.user.role)) {
      await authApi.logout().catch(() => undefined);
      return 'notAdmin';
    }
    applyTheme(result.user.theme);
    setState({ status: 'signedIn', user: result.user });
    return 'signedIn';
  }, []);

  const logout = useCallback(async () => {
    // The next person to use this browser shouldn't get the owner's alerts.
    await disablePush().catch(() => undefined);
    await authApi.logout().catch(() => undefined);
    setState({ status: 'signedOut' });
  }, []);

  const updateUser = useCallback((user: User) => setState({ status: 'signedIn', user }), []);

  const value = useMemo(
    () => ({ state, login, logout, adoptSession, updateUser }),
    [state, login, logout, adoptSession, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
