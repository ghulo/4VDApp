import { describe, expect, it } from 'vitest';
import { isTypingTarget, rankMatches } from './matching';

const items = [
  { label: 'Products', keywords: 'catalog items' },
  { label: 'Promotions', keywords: 'discounts sales' },
  { label: 'Oak dining chair', keywords: 'FUR-CHAIR-OAK' },
  { label: 'Ana Kovač', keywords: 'employee' },
];

describe('rankMatches', () => {
  it('should put words that start with the query before ones that only contain it', () => {
    expect(rankMatches('pro', items).map((item) => item.label)).toEqual(['Products', 'Promotions']);
    expect(rankMatches('chair', items).map((item) => item.label)).toEqual(['Oak dining chair']);
  });

  it('should ignore case and accents, and search keywords too', () => {
    expect(rankMatches('kovac', items).map((item) => item.label)).toEqual(['Ana Kovač']);
    expect(rankMatches('DISCOUNTS', items).map((item) => item.label)).toEqual(['Promotions']);
    expect(rankMatches('fur-chair', items).map((item) => item.label)).toEqual(['Oak dining chair']);
  });

  it('should match every word of a multi-word query', () => {
    expect(rankMatches('oak chair', items).map((item) => item.label)).toEqual(['Oak dining chair']);
    expect(rankMatches('oak lamp', items)).toEqual([]);
  });

  it('should return everything, in order, for an empty query', () => {
    expect(rankMatches('  ', items)).toEqual(items);
  });
});

describe('isTypingTarget', () => {
  it('should treat fields as places to type, and the page as not', () => {
    expect(isTypingTarget({ tagName: 'INPUT', isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA', isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT', isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'BODY', isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
