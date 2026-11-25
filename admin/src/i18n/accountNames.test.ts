import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { englishAccountName } from './accountNames';

// The starting chart lives in the backend; every account in it needs an English name here.
const chart = readFileSync(resolve(__dirname, '../../../backend/src/constants/chartOfAccounts.ts'), 'utf8');
const accounts = [...chart.matchAll(/number: '(\d+)', name: '([^']+)'/g)].map(([, number, name]) => ({ number, name }));

describe('English account names', () => {
  it('cover every account of the starting chart, by its exact Albanian name', () => {
    expect(accounts.length).toBeGreaterThan(140);
    const missing = accounts.filter((account) => englishAccountName(account.number, account.name) === null);
    expect(missing).toEqual([]);
  });

  it('leave a renamed account as the owner typed it', () => {
    expect(englishAccountName('1110', 'Arka')).toBe('Cash on hand');
    expect(englishAccountName('1110', 'Arka e dyqanit')).toBeNull();
    expect(englishAccountName('9999', 'Anything')).toBeNull();
  });
});
