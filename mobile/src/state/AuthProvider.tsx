import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { authApi } from '../services/api';
import { setSessionExpiredHandler, tokenStore } from '../services/apiClient';
import { AuthContext, type AuthState } from './useAuth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  // Restore the session from secure storage when the app starts.
  useEffect(() => {
    setSessionExpiredHandler(() => setState({ status: 'signedOut' }));
    tokenStore
      .load()
      .then(async (hasToken) => {
        if (!hasToken) return setState({ status: 'signedOut' });
        const user = await authApi.me();
        setState({ status: 'signedIn', user });
      })
      .catch(async () => {
        await tokenStore.clear();
        setState({ status: 'signedOut' });
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const user = await authApi.login(email, password);
    setState({ status: 'signedIn', user });
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    // Don't show the next person on this phone someone else's cached data.
    queryClient.clear();
    setState({ status: 'signedOut' });
  }, [queryClient]);

  const value = useMemo(() => ({ state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
