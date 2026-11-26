import { describe, expect, it } from 'vitest';
import { sortRows } from './DataTable';

const rows = [
  { name: 'Zana', owed: 5 },
  { name: 'ërmira', owed: null },
  { name: 'Agim', owed: 120 },
  { name: 'Çlirim', owed: 5 },
  { name: 'Item 10', owed: 0 },
  { name: 'Item 9', owed: 40 },
];

describe('sortRows', () => {
  it('orders names the Albanian way, numbers inside names by size', () => {
    const names = sortRows(rows, (row) => row.name, 'asc', 'sq').map((row) => row.name);
    expect(names).toEqual(['Agim', 'Çlirim', 'ërmira', 'Item 9', 'Item 10', 'Zana']);
  });

  it('puts blanks last both ways and keeps equal values in the list order', () => {
    const value = (row: (typeof rows)[number]) => row.owed;
    expect(sortRows(rows, value, 'desc', 'en').map((row) => row.name)).toEqual(['Agim', 'Item 9', 'Zana', 'Çlirim', 'Item 10', 'ërmira']);
    expect(sortRows(rows, value, 'asc', 'en').map((row) => row.name)).toEqual(['Item 10', 'Zana', 'Çlirim', 'Item 9', 'Agim', 'ërmira']);
  });
});
