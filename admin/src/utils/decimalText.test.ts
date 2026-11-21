import { describe, expect, it } from 'vitest';
import { decimalFromText } from './decimalText';

describe('decimalFromText', () => {
  it('reads a comma or a point', () => {
    expect(decimalFromText('7,5')).toBe(7.5);
    expect(decimalFromText('7.5')).toBe(7.5);
    expect(decimalFromText(' 12 ')).toBe(12);
    expect(decimalFromText(',25')).toBe(0.25);
    expect(decimalFromText('3,')).toBe(3);
  });

  it('refuses blanks, minus signs and typos', () => {
    for (const text of ['', ' ', '-1', '1,2,3', '1.2.3', 'abc', '1e3', '2x']) expect(decimalFromText(text)).toBeNaN();
  });
});
