import { describe, expect, it } from 'vitest';
import { readLanguage } from './language';

describe('readLanguage', () => {
  it('should use the saved choice', () => expect(readLanguage('sq', ['en-GB'])).toBe('sq'));
  it('should fall back to an Albanian phone', () => expect(readLanguage(null, ['sq-AL'])).toBe('sq'));
  it('should follow the phone’s order, not pick Albanian from anywhere in it', () =>
    expect(readLanguage(null, ['en-US', 'sq'])).toBe('en'));
  it('should fall back to English otherwise', () => expect(readLanguage('de', ['de-DE'])).toBe('en'));
});
