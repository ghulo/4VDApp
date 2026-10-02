import { describe, expect, it } from 'vitest';
import { readPreference, resolveTheme } from './theme';

const storage = (value: string | null) => ({ getItem: () => value });

describe('readPreference', () => {
  it('should return a saved choice', () => {
    expect(readPreference(storage('dark'))).toBe('dark');
    expect(readPreference(storage('light'))).toBe('light');
  });

  it('should fall back to system for nothing saved, junk, or no storage', () => {
    expect(readPreference(storage(null))).toBe('system');
    expect(readPreference(storage('purple'))).toBe('system');
    expect(readPreference(null)).toBe('system');
  });

  it('should fall back to system when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readPreference(blocked)).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('should follow the device for system, and the choice otherwise', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
