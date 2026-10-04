import { describe, expect, it } from 'vitest';
import { codeFromScan } from './scanLinks';

describe('codeFromScan', () => {
  it('should take the code out of a product QR link, and leave plain barcodes alone', () => {
    expect(codeFromScan('https://app.4vd.app/scan/2000000000039')).toBe('2000000000039');
    expect(codeFromScan('http://localhost:8081/scan/ABC-12?x=1')).toBe('ABC-12');
    expect(codeFromScan(' 4006381333931 ')).toBe('4006381333931');
  });
});
