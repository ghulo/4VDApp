import { describe, expect, it } from 'vitest';
import { readLanguage } from './language';

const storage = (value: string | null) => ({ getItem: () => value });
const blocked = {
  getItem: (): string | null => {
    throw new Error('blocked');
  },
};

describe('readLanguage', () => {
  it('should use the saved choice', () => expect(readLanguage(storage('sq'), ['en-GB'])).toBe('sq'));
  it('should fall back to an Albanian browser', () => expect(readLanguage(storage(null), ['sq-AL', 'en'])).toBe('sq'));
  it('should follow the browser’s order, not pick Albanian from anywhere in it', () =>
    expect(readLanguage(storage(null), ['en-US', 'en', 'sq'])).toBe('en'));
  it('should fall back to English otherwise', () => expect(readLanguage(storage('de'), ['de-DE'])).toBe('en'));
  it('should survive blocked storage', () => expect(readLanguage(blocked, ['sq'])).toBe('sq'));
});
