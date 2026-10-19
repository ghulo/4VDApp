import { describe, expect, it } from 'vitest';
import { eanCheckDigit, readScaleLabel } from './scaleLabel';

const label = (twelve: string) => `${twelve}${eanCheckDigit(twelve)}`;

describe('scale labels', () => {
  it('reads the PLU and the weight in grams', () => {
    expect(readScaleLabel(label('210123401250'))).toEqual({ plu: 1234, kg: 1.25 });
    expect(readScaleLabel(label('270000700775'))).toEqual({ plu: 7, kg: 0.775 });
  });

  it('knows the check digit of a real EAN-13', () => {
    expect(eanCheckDigit('400638133393')).toBe(1);
  });

  it('leaves other codes alone', () => {
    expect(readScaleLabel('4006381333931')).toBeNull();
    expect(readScaleLabel('21012340125')).toBeNull();
    // A misread digit fails the check.
    const good = label('210123401250');
    expect(readScaleLabel(`${good.slice(0, 12)}${(Number(good[12]) + 1) % 10}`)).toBeNull();
    expect(readScaleLabel(label('210000001250'))).toBeNull();
    expect(readScaleLabel(label('210123400000'))).toBeNull();
  });
});
