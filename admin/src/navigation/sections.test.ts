import { describe, expect, it } from 'vitest';
import { mainItemsFor, phoneTabsFor, SECTIONS } from './sections';

const paths = (items: Array<{ to: string }> | null) => items?.map((item) => item.to) ?? null;

describe('mainItemsFor', () => {
  it('should give the owner the pages they look at, in order', () => {
    expect(paths(mainItemsFor('owner'))).toEqual(['/', '/inbox', '/sales', '/inventory', '/report', '/ask']);
  });

  it('should give everyone else the whole menu', () => {
    expect(mainItemsFor('developer')).toBeNull();
    expect(mainItemsFor('admin')).toBeNull();
    expect(mainItemsFor('accountant')).toBeNull();
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
    expect(rare).toEqual(['accounts', 'opening', 'year', 'trefin']);
  });
});
