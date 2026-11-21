import { describe, expect, it } from 'vitest';
import { offlineLoadError } from './offlineLoad';

describe('offlineLoadError', () => {
  it('is a page that could not load without internet', () => {
    expect(offlineLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/Sales.js'), false)).toBe(true);
    expect(offlineLoadError(new Error('Unable to preload CSS for /assets/x.css'), false)).toBe(true);
  });

  it('is not a crash while online, or another kind of crash offline', () => {
    expect(offlineLoadError(new TypeError('Failed to fetch dynamically imported module'), true)).toBe(false);
    expect(offlineLoadError(new RangeError('Invalid time value'), false)).toBe(false);
  });
});
