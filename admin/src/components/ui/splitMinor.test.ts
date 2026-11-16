import { describe, expect, it } from 'vitest';
import { splitMinor } from './Motion';

describe('splitMinor', () => {
  it('should split the cents off an amount in either language', () => {
    expect(splitMinor('€1,482.40')).toEqual(['€1,482', '.40']);
    expect(splitMinor('1.482,40 €')).toEqual(['1.482', ',40 €']);
    expect(splitMinor('-€6.50')).toEqual(['-€6', '.50']);
  });

  it('should leave whole amounts and plain numbers whole', () => {
    expect(splitMinor('€38,420')).toEqual(['€38,420', '']);
    expect(splitMinor('38.420 €')).toEqual(['38.420 €', '']);
    expect(splitMinor('412')).toEqual(['412', '']);
    expect(splitMinor('12.50')).toEqual(['12.50', '']);
  });
});
