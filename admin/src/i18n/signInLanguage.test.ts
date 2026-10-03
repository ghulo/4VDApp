import { describe, expect, it } from 'vitest';
import { languageAfterSignIn } from './signInLanguage';

describe('languageAfterSignIn', () => {
  it('should keep the account’s language when nothing was picked on the sign-in screen', () =>
    expect(languageAfterSignIn('sq', null)).toEqual({ language: 'sq', saveToAccount: false }));

  it('should use and save a language picked on the sign-in screen', () =>
    expect(languageAfterSignIn('en', 'sq')).toEqual({ language: 'sq', saveToAccount: true }));

  it('should not save again when the pick matches the account', () =>
    expect(languageAfterSignIn('sq', 'sq')).toEqual({ language: 'sq', saveToAccount: false }));
});
