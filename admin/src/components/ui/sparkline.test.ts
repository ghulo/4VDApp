import { describe, expect, it } from 'vitest';
import { changeDirection, scaleTop, sparklinePaths } from './sparkline';

describe('sparklinePaths', () => {
  it('should have nothing to draw for no data or all zeros', () => {
    expect(sparklinePaths([])).toBeNull();
    expect(sparklinePaths([0, 0, 0])).toBeNull();
  });

  it('should curve through the midpoints across the full width and close the area at the bottom', () => {
    const paths = sparklinePaths([0, 10, 5], 100, 50)!;
    expect(paths.line).toBe('M0,50 L25,26.5 Q50,3 75,14.8 L100,26.5');
    expect(paths.area).toBe('M0,50 L25,26.5 Q50,3 75,14.8 L100,26.5 L100,50 L0,50 Z');
  });

  it('should draw a single point as a flat line', () => {
    expect(sparklinePaths([7], 100, 50)!.line).toBe('M0,3 L50,3 L100,3');
  });

  it('should keep negative days (refunds) below the zero line', () => {
    expect(sparklinePaths([-10, 10], 100, 50)!.line).toBe('M0,50 L50,26.5 L100,3');
  });
});

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

  it('should keep the other days visible in a mini graph with one huge day', () => {
    const line = sparklinePaths([0, 1000, 20, 10], 120, 50)!.line;
    expect(line).toContain('Q40,3'); // the huge day runs to the top edge
    expect(line).toContain('Q80,12.4'); // the 20 keeps its height instead of hugging the floor
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
