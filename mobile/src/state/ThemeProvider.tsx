import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { secureStorage } from '../services/secureStorage';
import { palettes, parsePreference, ThemeContext, type ThemePreference } from '../theme';

const STORAGE_KEY = '4vd.theme';

/** Light, dark, or follow the phone. The choice is remembered on this device. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    secureStorage
      .getItem(STORAGE_KEY)
      .then((saved) => setPreferenceState(parsePreference(saved)))
      .catch(() => undefined); // unreadable storage: stay on "system"
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    secureStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo(() => {
    const scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
    return { colors: palettes[scheme], scheme, preference, setPreference } as const;
  }, [preference, system, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
