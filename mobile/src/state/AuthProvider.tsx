import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { authApi } from '../services/api';
import { setSessionExpiredHandler, tokenStore } from '../services/apiClient';
import { disablePush } from '../push/devicePush';
import type { User } from '../services/types';
import { useTheme } from '../theme';
import { AuthContext, type AuthState } from './useAuth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const { setPreference } = useTheme();

  // Restore the session from secure storage when the app starts.
  useEffect(() => {
    setSessionExpiredHandler(() => setState({ status: 'signedOut' }));
    tokenStore
      .load()
      .then(async (hasToken) => {
        if (!hasToken) return setState({ status: 'signedOut' });
        const user = await authApi.me();
        // The theme someone picked follows them from device to device.
        setPreference(user.theme);
        setState({ status: 'signedIn', user });
      })
      .catch(async () => {
        await tokenStore.clear();
        setState({ status: 'signedOut' });
      });
  }, [setPreference]);

  const login = useCallback(
    async (email: string, password: string) => {
      const user = await authApi.login(email, password);
      setPreference(user.theme);
      setState({ status: 'signedIn', user });
    },
    [setPreference],
  );

  const updateUser = useCallback((user: User) => setState({ status: 'signedIn', user }), []);

  const logout = useCallback(async () => {
    // The next person on this phone shouldn't get these alerts.
    await disablePush().catch(() => undefined);
    await authApi.logout().catch(() => undefined);
    // Don't show the next person on this phone someone else's cached data.
    queryClient.clear();
    setState({ status: 'signedOut' });
  }, [queryClient]);

  const value = useMemo(() => ({ state, login, logout, updateUser }), [state, login, logout, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
