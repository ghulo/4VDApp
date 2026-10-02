import { Desktop, Moon, Sun, type Icon } from '@phosphor-icons/react';
import { useAuth } from '../auth/useAuth';
import { meApi } from '../services/api';
import { type ThemePreference, useThemePreference } from './theme';

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: Icon }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Auto', icon: Desktop },
];

interface ThemeSwitchProps {
  className?: string;
  /** Signed-in pages also save the choice to the profile, so it follows the person to other devices. */
  persist?: boolean;
  /** Icons only, for the top bar. */
  compact?: boolean;
}

/** Light / Dark / Auto. Auto follows the computer's setting. */
export function ThemeSwitch({ className = '', persist = false, compact = false }: ThemeSwitchProps) {
  const [preference, setPreference] = useThemePreference();
  const { updateUser } = useAuth();

  function choose(next: ThemePreference) {
    setPreference(next);
    if (persist) meApi.updateProfile({ theme: next }).then(updateUser).catch(() => undefined);
  }

  return (
    <div
      className={`segmented segmented--small ${compact ? 'segmented--icons' : ''} ${className}`}
      role="radiogroup"
      aria-label="Theme"
    >
      {OPTIONS.map((option) => {
        const OptionIcon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={preference === option.value}
            aria-label={compact ? option.label : undefined}
            title={compact ? option.label : undefined}
            className="segmented__option"
            onClick={() => choose(option.value)}
          >
            <OptionIcon size={14} weight={preference === option.value ? 'fill' : 'regular'} aria-hidden="true" />
            {!compact && option.label}
          </button>
        );
      })}
    </div>
  );
}
