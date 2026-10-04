import { describe, expect, it } from 'vitest';
import { changeDirection, sparklinePaths } from './sparkline';

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

describe('changeDirection', () => {
  it('should say which way the figure moved', () => {
    expect(changeDirection(0.12)).toBe('up');
    expect(changeDirection(-0.3)).toBe('down');
    expect(changeDirection(0)).toBe('flat');
    expect(changeDirection(null)).toBeNull();
  });
});
