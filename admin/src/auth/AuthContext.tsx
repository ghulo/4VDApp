import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { authApi } from '../services/api';
import { setSessionExpiredHandler, tokenStore } from '../services/apiClient';
import { disablePush } from '../push/browserPush';
import { AuthContext, type AuthState } from './useAuth';

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
    if (user.role !== 'admin') {
      await authApi.logout();
      throw new Error('This dashboard is for admins. Use the mobile app to browse products.');
    }
    setState({ status: 'signedIn', user });
  }, []);

  const logout = useCallback(async () => {
    // The next person to use this browser shouldn't get the owner's alerts.
    await disablePush().catch(() => undefined);
    await authApi.logout().catch(() => undefined);
    setState({ status: 'signedOut' });
  }, []);

  const value = useMemo(() => ({ state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
