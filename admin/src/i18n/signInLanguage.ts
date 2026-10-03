import type { Language } from './language';

const PICKED_KEY = '4vd.language.picked';

/** Remember a language someone picked on a sign-in screen, for this visit only. */
export function rememberSignInPick(language: Language): void {
  try {
    sessionStorage.setItem(PICKED_KEY, language);
  } catch {
    // Blocked storage: the account's language will apply after sign-in.
  }
}

/** The language picked on a sign-in screen this visit, used once. */
export function takeSignInPick(): Language | null {
  try {
    const picked = sessionStorage.getItem(PICKED_KEY);
    sessionStorage.removeItem(PICKED_KEY);
    return picked === 'en' || picked === 'sq' ? picked : null;
  } catch {
    return null;
  }
}

/**
 * After signing in, the account's saved language applies, unless the person
 * picked one on the sign-in screen just now: that explicit choice wins and is
 * saved to the account, so it follows them to other devices.
 */
export function languageAfterSignIn(account: Language, picked: Language | null): { language: Language; saveToAccount: boolean } {
  if (picked && picked !== account) return { language: picked, saveToAccount: true };
  return { language: account, saveToAccount: false };
}
