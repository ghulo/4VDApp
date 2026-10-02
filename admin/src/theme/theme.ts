import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

/** Same key as the script in index.html, which applies it before the page paints. */
export const THEME_STORAGE_KEY = '4vd.theme';
const PREFERENCES: ThemePreference[] = ['light', 'dark', 'system'];
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The saved choice, or "system" when nothing usable is saved or storage is blocked. */
export function readPreference(storage: Pick<Storage, 'getItem'> | null): ThemePreference {
  try {
    const saved = storage?.getItem(THEME_STORAGE_KEY);
    return PREFERENCES.includes(saved as ThemePreference) ? (saved as ThemePreference) : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? false;
}

/** Colours the page now, and remembers the choice for next time. */
export function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference, systemPrefersDark());
  try {
    safeStorage()?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Blocked storage: the theme still applies for this visit.
  }
}

/** The current choice and a setter; follows the device live while the choice is "system". */
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(() => readPreference(safeStorage()));

  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system') return;
    const media = window.matchMedia?.(DARK_QUERY);
    const follow = () => applyTheme('system');
    media?.addEventListener('change', follow);
    return () => media?.removeEventListener('change', follow);
  }, [preference]);

  return [preference, useCallback((next: ThemePreference) => setPreference(next), [])];
}
