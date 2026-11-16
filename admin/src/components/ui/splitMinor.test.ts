import { describe, expect, it } from 'vitest';
import { markMatches } from './Combobox';
import { splitMinor } from './Motion';

describe('markMatches', () => {
  it('should mark the typed letters, ignoring accents and case', () => {
    expect(markMatches('Çlirim Berisha', 'cli')).toEqual([
      { text: 'Çli', hit: true },
      { text: 'rim Berisha', hit: false },
    ]);
    expect(markMatches('Arta Krasniqi', 'kras arta').filter((part) => part.hit).map((part) => part.text)).toEqual(['Arta', 'Kras']);
    expect(markMatches('Arta', '')).toEqual([{ text: 'Arta', hit: false }]);
  });
});

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
