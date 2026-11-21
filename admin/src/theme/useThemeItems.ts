import { Desktop, Moon, Sun } from '@phosphor-icons/react';
import { useSyncExternalStore } from 'react';
import { useAuth } from '../auth/useAuth';
import type { MenuItem } from '../components/ui';
import { useT } from '../i18n/useT';
import { meApi } from '../services/api';
import { useThemePreference } from './theme';

/** Where the top bar hides its Light / Dark / Auto switch (shell.css). */
const NARROW = '(max-width: 900px)';
const watchNarrow = (changed: () => void) => {
  const query = window.matchMedia(NARROW);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
};

/**
 * Light / Dark / Auto as lines of the avatar menu, on a phone only: there the
 * top bar has no room for the switch, and in the sun dark is hard to read.
 * Saved to the profile like the switch, so it follows the person.
 */
export function useThemeItems(): MenuItem[] {
  const t = useT();
  const { updateUser } = useAuth();
  const [preference, setPreference] = useThemePreference();
  const narrow = useSyncExternalStore(watchNarrow, () => window.matchMedia(NARROW).matches);
  if (!narrow) return [];
  const choose = (next: typeof preference) => {
    setPreference(next);
    meApi.updateProfile({ theme: next }).then(updateUser).catch(() => undefined);
  };
  return [
    { label: t.theme.light, icon: Sun, checked: preference === 'light', divider: true, onSelect: () => choose('light') },
    { label: t.theme.dark, icon: Moon, checked: preference === 'dark', onSelect: () => choose('dark') },
    { label: t.theme.auto, icon: Desktop, checked: preference === 'system', onSelect: () => choose('system') },
  ];
}
