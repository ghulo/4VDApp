import { describe, expect, it } from 'vitest';
import { changeDirection, scaleTop } from './sparkline';

describe('scaleTop', () => {
  it('should scale to the highest value when nothing stands far out', () => {
    expect(scaleTop([10, 30, 40])).toEqual({ top: 40, outlier: null });
    expect(scaleTop([0, 0, 50])).toEqual({ top: 50, outlier: null });
    expect(scaleTop([])).toEqual({ top: 0, outlier: null });
  });

  it('should cap the scale when the top value is more than four times the next', () => {
    expect(scaleTop([10, 1000, 20])).toEqual({ top: 25, outlier: 1 });
    expect(scaleTop([10, 40])).toEqual({ top: 40, outlier: null });
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
