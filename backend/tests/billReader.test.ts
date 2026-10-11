import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { describe, expect, it } from 'vitest';
import { toReading, wireSchema } from '../src/services/ai/billReader.js';

/** Counts the fields Claude's structured outputs treat as unions: anyOf, or a list of types. */
function unions(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const own = 'anyOf' in node || Array.isArray((node as { type?: unknown }).type) ? 1 : 0;
  return own + Object.values(node).reduce<number>((sum, child) => sum + unions(child), 0);
}

describe('bill reader schema', () => {
  it('should stay well under the API limit on nullable fields', () => {
    // The API refused 17; keep a margin so a new field doesn't break scanning.
    expect(unions(zodOutputFormat(wireSchema).schema)).toBeLessThanOrEqual(8);
  });

  it('should turn blanks back into missing values', () => {
    const reading = toReading({
      supplier: { name: ' ', nui: '811234567' },
      number: '',
      issuedOn: '2026-10-11',
      dueOn: '',
      pricesIncludeVat: false,
      lines: [{ code: '', barcode: '', name: 'Ujë 0.5L', quantity: 2, unit: 'pako', unitsPerPack: 1, unitPrice: 3, discountPercent: 0, vatRate: null, lineTotal: null }],
      totals: { net: 6, vat: null, gross: null },
      remarks: '',
    });
    expect(reading).toMatchObject({ supplier: { name: null, nui: '811234567' }, number: null, dueOn: null, remarks: null });
    expect(reading.lines[0]).toMatchObject({ code: null, barcode: null, unit: 'pako', unitsPerPack: null, discountPercent: null, vatRate: null });
  });
});
