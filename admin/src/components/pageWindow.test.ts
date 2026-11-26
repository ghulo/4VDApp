import { describe, expect, it } from 'vitest';
import { pageWindow } from './pageWindow';

describe('pageWindow', () => {
  it('shows every page when there are seven or fewer', () => {
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('keeps the first, the last and the pages around the current one, seven places at most', () => {
    expect(pageWindow(1, 50)).toEqual([1, 2, 3, 4, 5, 'gap', 50]);
    expect(pageWindow(10, 50)).toEqual([1, 'gap', 9, 10, 11, 'gap', 50]);
    expect(pageWindow(50, 50)).toEqual([1, 'gap', 46, 47, 48, 49, 50]);
    for (let page = 1; page <= 50; page++) expect(pageWindow(page, 50).length).toBe(7);
  });
});
