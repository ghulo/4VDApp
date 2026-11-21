import { describe, expect, it } from 'vitest';
import { defaultPreference, readMotionPreference, resolveMotion } from './motion';

describe('Motion setting', () => {
  it('Automatic follows the device; the other choices stand as they are', () => {
    expect(resolveMotion('auto', false)).toBe('full');
    expect(resolveMotion('auto', true)).toBe('reduced');
    expect(resolveMotion('full', true)).toBe('full');
    expect(resolveMotion('reduced', false)).toBe('reduced');
    expect(resolveMotion('off', false)).toBe('off');
  });

  it('the Windows app on a PC with 4 GB or less starts on Reduced; everything else on Automatic', () => {
    expect(defaultPreference(true, 4)).toBe('reduced');
    expect(defaultPreference(true, 2)).toBe('reduced');
    expect(defaultPreference(true, 8)).toBe('auto');
    expect(defaultPreference(true, undefined)).toBe('auto');
    expect(defaultPreference(false, 2)).toBe('auto');
  });

  it('reads a saved choice, and falls back on nonsense or blocked storage', () => {
    expect(readMotionPreference({ getItem: () => 'off' }, 'auto')).toBe('off');
    expect(readMotionPreference({ getItem: () => 'wild' }, 'reduced')).toBe('reduced');
    expect(readMotionPreference({ getItem: () => { throw new Error('blocked'); } }, 'auto')).toBe('auto');
    expect(readMotionPreference(null, 'auto')).toBe('auto');
  });
});
