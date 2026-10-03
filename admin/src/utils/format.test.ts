import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney, setFormatLanguage } from './format';

afterEach(() => setFormatLanguage('en'));

describe('formatMoney', () => {
  it('should write euros the English way', () => expect(formatMoney(1204.5)).toBe('€1,204.50'));
  it('should write euros the Albanian way after switching', () => {
    setFormatLanguage('sq');
    // Albanian groups thousands with a space, and only from five digits up.
    expect(formatMoney(1204.5)).toMatch(/^1204,50\s€$/);
    expect(formatMoney(12045.5)).toMatch(/^12\s045,50\s€$/);
  });
});
