import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { meApi } from '../services/api';
import type { Language } from './language';
import { useLanguage, useT } from './useT';
import { rememberSignInPick } from './signInLanguage';

interface LanguageSwitchProps {
  className?: string;
  /** Signed-in pages also save the choice to the profile, so it follows the person to other devices. */
  persist?: boolean;
}

/** English / Shqip. */
export function LanguageSwitch({ className = '', persist = false }: LanguageSwitchProps) {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  const { updateUser } = useAuth();
  const queryClient = useQueryClient();
  const options: Array<{ value: Language; label: string }> = [
    { value: 'en', label: t.language.english },
    { value: 'sq', label: t.language.albanian },
  ];

  function choose(next: Language) {
    // On a sign-in screen the pick is remembered, and saved to the account once signed in.
    if (!persist) rememberSignInPick(next);
    if (persist) {
      meApi
        .updateProfile({ language: next })
        .then((user) => {
          updateUser(user);
          // Alerts and the attention list come from the server in the saved language.
          return queryClient.invalidateQueries();
        })
        .catch(() => undefined);
    }
    setLanguage(next);
  }

  return (
    <div className={`segmented segmented--small ${className}`} role="radiogroup" aria-label={t.language.label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={language === option.value}
          lang={option.value}
          translate="no"
          className="segmented__option"
          onClick={() => choose(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
