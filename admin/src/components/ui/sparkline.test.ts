import { describe, expect, it } from 'vitest';
import { changeDirection, sparkBlocks } from './sparkline';

describe('sparkBlocks', () => {
  it('should have nothing to draw for no data or all zeros', () => {
    expect(sparkBlocks([])).toBeNull();
    expect(sparkBlocks([0, 0, 0])).toBeNull();
  });

  it('should light blocks in proportion to the biggest day', () => {
    expect(sparkBlocks([0, 10, 5], 10, 3)).toEqual([0, 10, 5]);
  });

  it('should light at least one block for a small but real day', () => {
    expect(sparkBlocks([1, 1000], 10, 2)).toEqual([1, 10]);
  });

  it('should average long series into fewer columns', () => {
    expect(sparkBlocks([2, 4, 6, 8], 4, 2)).toEqual([2, 4]);
  });

  it('should repeat short series across the columns', () => {
    expect(sparkBlocks([5, 10], 10, 4)).toEqual([5, 5, 10, 10]);
  });

  it('should keep negative days (refunds) at the bottom', () => {
    expect(sparkBlocks([-10, 10], 10, 2)).toEqual([1, 10]);
  });
});

describe('changeDirection', () => {
  it('should say which way the figure moved', () => {
    expect(changeDirection(0.12)).toBe('up');
    expect(changeDirection(-0.3)).toBe('down');
    expect(changeDirection(0)).toBe('flat');
    expect(changeDirection(null)).toBeNull();
  });
});
