import { useQueryClient } from '@tanstack/react-query';
import { ChoiceRow } from '../components/inputs';
import { meApi } from '../services/api';
import { useAuth } from '../state/useAuth';
import type { Language } from './language';
import { useLanguage, useT } from './useT';

/** English / Shqip. Signed in, the choice is saved to the account so it follows the person to other devices. */
export function LanguageSwitch({ persist = false }: { persist?: boolean }) {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  const { updateUser } = useAuth();
  const queryClient = useQueryClient();

  function choose(next: Language) {
    setLanguage(next);
    if (!persist) return;
    meApi
      .updateProfile({ language: next })
      .then((user) => {
        updateUser(user);
        // Alerts come from the server in the saved language.
        return queryClient.invalidateQueries();
      })
      .catch(() => undefined);
  }

  return (
    <ChoiceRow
      label={t.language.label}
      options={[
        { value: 'en', label: t.language.english },
        { value: 'sq', label: t.language.albanian },
      ]}
      value={language}
      onChange={choose}
    />
  );
}
