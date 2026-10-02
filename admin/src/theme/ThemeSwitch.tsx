import { type ThemePreference, useThemePreference } from './theme';

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
];

/** Light / Dark / Auto. Auto follows the computer's setting. */
export function ThemeSwitch({ className = '' }: { className?: string }) {
  const [preference, setPreference] = useThemePreference();
  return (
    <div className={`segmented segmented--small ${className}`} role="radiogroup" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={preference === option.value}
          className="segmented__option"
          onClick={() => setPreference(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
