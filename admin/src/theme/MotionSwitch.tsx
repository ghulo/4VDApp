import { type MotionPreference, useMotionPreference } from './motion';
import { useT } from '../i18n/useT';
import { radioKeys } from '../components/ui/radioKeys';

const OPTIONS: MotionPreference[] = ['auto', 'full', 'reduced', 'off'];

/** Motion: Automatic · Full · Reduced · Off, for this device only (theme/motion.ts). */
export function MotionSwitch() {
  const [preference, setPreference] = useMotionPreference();
  const t = useT();
  return (
    <div className="segmented segmented--small" role="radiogroup" aria-label={t.motion.label}>
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={preference === option}
          tabIndex={preference === option ? 0 : -1}
          className="segmented__option"
          onClick={() => setPreference(option)}
          onKeyDown={radioKeys}
        >
          {t.motion[option]}
        </button>
      ))}
    </div>
  );
}
