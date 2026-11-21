import { describe, expect, it } from 'vitest';
import { setPermissions, DEFAULT_PERMISSIONS } from '../auth/permissions';
import { NAV_GROUPS, phoneTabsFor, SECTIONS, shownTo, tabSearch } from './sections';

const paths = (items: Array<{ to: string }> | null) => items?.map((item) => item.to) ?? null;

describe('shownTo', () => {
  const every = NAV_GROUPS.flatMap((group) => group.items);

  it('should show the owner every page, the Counter, Day, Books and Settings too', () => {
    expect(every.filter((item) => !shownTo('owner', item))).toEqual([]);
    expect(['/counter', '/day', '/books', '/settings'].every((to) => shownTo('owner', { to }))).toBe(true);
  });

  it('should keep showing the owner every page when Settings → Roles hides one', () => {
    setPermissions({ ...DEFAULT_PERMISSIONS, pages: { '/books': ['accountant'] } });
    try {
      expect(shownTo('owner', every.find((item) => item.to === '/books')!)).toBe(true);
      expect(shownTo('admin', every.find((item) => item.to === '/books')!)).toBe(false);
    } finally {
      setPermissions(DEFAULT_PERMISSIONS);
    }
  });

  it('should keep Settings from the accountant', () => {
    expect(shownTo('accountant', every.find((item) => item.to === '/settings')!)).toBe(false);
  });
});

describe('phoneTabsFor', () => {
  it('should put the four most used pages along the bottom', () => {
    expect(paths(phoneTabsFor('admin'))).toEqual(['/', '/inbox', '/sales', '/inventory']);
    expect(paths(phoneTabsFor('owner'))).toEqual(['/', '/inbox', '/sales', '/inventory']);
  });

  it('should give the accountant only money-side pages', () => {
    expect(paths(phoneTabsFor('accountant'))).toEqual(['/inbox', '/sales', '/books']);
  });
});

describe('SECTIONS', () => {
  it('should keep the books row to setup and year end under More', () => {
    const rare = SECTIONS.books.filter((tab) => 'rare' in tab && tab.rare).map((tab) => tab.key);
    expect(rare).toEqual(['accounts', 'opening', 'year', 'declaration', 'trefin']);
  });
});

describe('tabSearch', () => {
  it('should carry the VAT month from the return to both books', () => {
    const tabs = SECTIONS.books.filter((tab) => ['vat', 'salesBook', 'purchaseBook'].includes(tab.key));
    expect(tabs.map((tab) => tabSearch(tab, '?month=2026-09&from=2026-01-01'))).toEqual(['?month=2026-09', '?month=2026-09', '?month=2026-09']);
  });
  it('should keep everything for keepSearch true and nothing without it', () => {
    expect(tabSearch({ keepSearch: true }, '?from=a&to=b')).toBe('?from=a&to=b');
    expect(tabSearch({}, '?month=2026-09')).toBe('');
    expect(tabSearch({ keepSearch: ['month'] }, '?from=a')).toBe('');
  });
});
