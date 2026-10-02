import { useAuth } from '../auth/useAuth';
import { meApi } from '../services/api';
import { type ThemePreference, useThemePreference } from './theme';

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
];

/**
 * Light / Dark / Auto. Auto follows the computer's setting. With `persist`
 * (signed-in pages) the choice is also saved to the profile, so it follows the
 * person to their other devices.
 */
export function ThemeSwitch({ className = '', persist = false }: { className?: string; persist?: boolean }) {
  const [preference, setPreference] = useThemePreference();
  const { updateUser } = useAuth();

  function choose(next: ThemePreference) {
    setPreference(next);
    if (persist) meApi.updateProfile({ theme: next }).then(updateUser).catch(() => undefined);
  }

  return (
    <div className={`segmented segmented--small ${className}`} role="radiogroup" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={preference === option.value}
          className="segmented__option"
          onClick={() => choose(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
